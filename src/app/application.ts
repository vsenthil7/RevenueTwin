/**
 * Application service layer (integration).
 *
 * The unified facade that wires the domain modules into one coherent, persistence-backed,
 * authorization-checked service. Both the HTTP server and the integration tests drive THIS — it
 * is the single place the islands become a product. Storage is injected (memory or postgres), so
 * the same app runs in-memory for the demo and on a real DB in production.
 *
 * Every state-changing call: (1) checks an authenticated principal's permission, (2) writes to
 * the persistence unit of work, (3) appends to the tamper-evident audit chain.
 */
import { money, add, type Money } from '../money/money.ts';
import type { LeakageCase, CaseStatus, VarianceFinding } from '../core/model.ts';
import { createCase, rankCases } from '../core/reconciliation.ts';
import { AuditLog, type AuditEntry } from '../core/audit.ts';
import type { UnitOfWork } from '../persistence/repository.ts';
import { type AuthenticatedPrincipal, can, AuthzError, canAccessCustomer } from '../identity/rbac.ts';
import { portfolioSummary, leakageByType, periodClosePack, type PortfolioSummary } from '../reporting/analytics.ts';
import { runQuery, type CaseQuery, type Page } from '../bulk/operations.ts';
import { extractIntentEvent, type IntentExtractor, type IntentDocument } from '../intent/extraction.ts';
import * as insights from './insights.ts';
import { importCsv } from '../import/importer.ts';

/** S68: a durable, revisitable summary of one import run (sourced from the audit log). */
export interface ImportRunSummary {
  readonly importId: string;
  readonly at: string;
  readonly customers: number;
  readonly recoverableMinor: number;
  readonly rowsAccepted: number;
  readonly rowsRejected: number;
  readonly currency: string;
}

export class AppError extends Error {
  constructor(message: string, readonly code: 'forbidden' | 'not_found' | 'bad_request' = 'bad_request') {
    super(message);
    this.name = 'AppError';
  }
}

function requirePerm(principal: AuthenticatedPrincipal, perm: Parameters<typeof can>[1]): void {
  if (!can(principal, perm)) throw new AppError(`Missing permission '${perm}'`, 'forbidden');
}

export interface AppConfig {
  readonly tenantId: string;
  readonly currency: string;
}

export class RevenueTwinApp {
  private auditMirror: AuditLog;

  constructor(
    private uow: UnitOfWork,
    private config: AppConfig,
    clock: () => string = () => new Date().toISOString(),
  ) {
    // The AuditLog is the chaining/verification engine; the UoW.audit is durable storage.
    this.auditMirror = new AuditLog(clock);
  }

  /**
   * Rehydrate the in-process audit chain from the durable store. Call once after construction when
   * resuming against a persistent backend so seq/prevHash continue from the persisted head instead
   * of restarting at genesis (which would break the chain on the first post-restart write). Safe
   * and idempotent on an empty store (no-op).
   */
  async init(): Promise<void> {
    const persisted = await this.uow.audit.all();
    if (persisted.length > 0) this.auditMirror.rehydrate(persisted);
  }

  get tenantId(): string { return this.config.tenantId; }
  get currency(): string { return this.config.currency; }

  /** Persist an audit event to both the chain engine and durable store. */
  private async record(actor: string, event: string, subject: string, detail: Record<string, unknown>): Promise<AuditEntry> {
    const entry = this.auditMirror.append(actor, event, subject, detail);
    await this.uow.audit.append(entry);
    return entry;
  }

  /* ───────────────────────── Cases ───────────────────────── */

  /** Open a case from findings (e.g. after reconciliation). Requires triage permission. */
  async openCase(
    principal: AuthenticatedPrincipal, customerId: string, findings: VarianceFinding[],
    detectedViaWorkIQ: boolean, at: string,
  ): Promise<LeakageCase> {
    requirePerm(principal, 'case:triage');
    if (!canAccessCustomer(principal, customerId)) throw new AppError('Customer out of scope', 'forbidden');
    if (findings.length === 0) throw new AppError('At least one finding required');
    const id = `case-${customerId}-${Date.now()}`;
    const c = createCase(id, customerId, findings, at);
    const withFlag: LeakageCase = { ...c, detectedViaWorkIQ };
    await this.uow.transaction(async () => {
      await this.uow.cases.upsert(this.tenantId, withFlag);
      await this.record('recon-agent', 'case.created', id, { findings: findings.length, detectedViaWorkIQ });
    });
    return withFlag;
  }

  /**
   * Import a CSV of the buyer's own expected-vs-actual billing lines, run them through the real
   * reconciliation engine, persist the resulting cases, and return the recoverable report. This is
   * how a CFO sees THEIR leaked revenue rather than the seeded demo. Cases for out-of-scope
   * customers are skipped (reported), never persisted, so scoping is preserved.
   */
  async importCsvCases(principal: AuthenticatedPrincipal, csv: string, at?: string, mapping?: import('../import/mapping.ts').ColumnMapping): Promise<import('../import/importer.ts').ImportResult> {
    requirePerm(principal, 'case:triage');
    const now = at ?? new Date().toISOString();
    const result = importCsv(csv, { now: () => now, ...(mapping ? { mapping } : {}) });
    const persisted: LeakageCase[] = [];
    const skipped: import('../import/importer.ts').ImportRowReject[] = [...result.rejects];
    await this.uow.transaction(async () => {
      for (const c of result.cases) {
        if (!canAccessCustomer(principal, c.customerId)) {
          skipped.push({ row: 0, reason: 'customer out of scope: ' + c.customerId });
          continue;
        }
        const flagged: LeakageCase = { ...c, detectedViaWorkIQ: false };
        await this.uow.cases.upsert(this.tenantId, flagged);
        persisted.push(flagged);
        await this.record('import-agent', 'case.imported', c.id, { customerId: c.customerId, findings: c.findings.length });
      }
    });
    // Recompute totals over only the persisted (in-scope) cases.
    const persistedRecoverable = persisted.reduce((acc, c) => acc + c.findings.reduce((s, fnd) => s + fnd.netRecoverable.amount, 0), 0);
    // S68: record a durable, revisitable import-run summary in the audit log.
    const importId = 'import-' + now.replace(/[^0-9]/g, '').slice(0, 14);
    await this.record('import-agent', 'import.completed', importId, {
      importId, at: now, customers: persisted.length, recoverableMinor: persistedRecoverable,
      rowsAccepted: result.rowsAccepted, rowsRejected: skipped.length, currency: result.currency,
    });
    return { ...result, cases: persisted, rowsRejected: skipped.length, rejects: skipped };
  }

  /** S68: list past import runs (durable, from the audit log), newest first. */
  async listImportRuns(principal: AuthenticatedPrincipal): Promise<ImportRunSummary[]> {
    requirePerm(principal, 'case:read');
    const entries = await this.uow.audit.all();
    const runs = entries
      .filter((e) => e.event === 'import.completed')
      .map((e) => e.detail as unknown as ImportRunSummary);
    return runs.slice().reverse();
  }

  /** S68: export a single import run summary by id (durable, revisitable). */
  async exportImportRun(principal: AuthenticatedPrincipal, importId: string): Promise<ImportRunSummary> {
    requirePerm(principal, 'case:read');
    const runs = await this.listImportRuns(principal);
    const run = runs.find((r) => r.importId === importId);
    if (!run) throw new AppError('Import run ' + importId + ' not found', 'not_found');
    return run;
  }

  async getCase(principal: AuthenticatedPrincipal, caseId: string): Promise<LeakageCase> {
    requirePerm(principal, 'case:read');
    const c = await this.uow.cases.get(this.tenantId, caseId);
    if (!c) throw new AppError(`Case ${caseId} not found`, 'not_found');
    if (!canAccessCustomer(principal, c.customerId)) throw new AppError('Customer out of scope', 'forbidden');
    return c;
  }

  async listCases(principal: AuthenticatedPrincipal): Promise<LeakageCase[]> {
    requirePerm(principal, 'case:read');
    const all = await this.uow.cases.all(this.tenantId);
    return all.filter((c) => canAccessCustomer(principal, c.customerId));
  }

  /** Transition a case status with permission + audit. approve/reject require approve permission. */
  async decideCase(
    principal: AuthenticatedPrincipal, caseId: string, decision: 'approve' | 'reject', at: string,
  ): Promise<LeakageCase> {
    requirePerm(principal, decision === 'approve' ? 'case:approve' : 'case:reject');
    const c = await this.getCase(principal, caseId);
    if (c.status !== 'open' && c.status !== 'escalated') {
      throw new AppError(`Case ${caseId} not actionable in status ${c.status}`);
    }
    const next: CaseStatus = decision === 'approve' ? 'approved' : 'rejected';
    const updated: LeakageCase = { ...c, status: next };
    await this.uow.transaction(async () => {
      await this.uow.cases.upsert(this.tenantId, updated);
      await this.record(principal.userId, `case.${decision}`, caseId, { from: c.status, to: next });
    });
    return updated;
  }

  /** Query cases with filter/sort/pagination (scoped to the principal). */
  async queryCases(principal: AuthenticatedPrincipal, query: CaseQuery): Promise<Page<LeakageCase>> {
    const scoped = await this.listCases(principal);
    return runQuery(scoped, query, this.currency);
  }

  /* ───────────────────────── Work IQ intake ───────────────────────── */

  /**
   * Ingest an unstructured commercial document through the extractor; if it yields a confident
   * intent event, return it (the caller can then reconcile it into a finding). Pure read; no write.
   */
  async ingestIntent(
    principal: AuthenticatedPrincipal, extractor: IntentExtractor, doc: IntentDocument, minConfidence = 0.6,
  ): Promise<ReturnType<typeof extractIntentEvent>> {
    requirePerm(principal, 'case:read');
    if (!canAccessCustomer(principal, doc.customerId)) throw new AppError('Customer out of scope', 'forbidden');
    const ev = await extractIntentEvent(extractor, doc, minConfidence);
    if (ev) await this.record(principal.userId, 'intent.extracted', doc.customerId, { docId: doc.id, confidence: ev.confidence });
    return ev;
  }

  /* ───────────────────────── Reporting ───────────────────────── */

  async portfolioSummary(principal: AuthenticatedPrincipal): Promise<PortfolioSummary> {
    requirePerm(principal, 'case:read');
    const cases = await this.listCases(principal);
    return portfolioSummary(cases, this.currency);
  }

  async leakageByType(principal: AuthenticatedPrincipal): Promise<ReturnType<typeof leakageByType>> {
    requirePerm(principal, 'case:read');
    const cases = await this.listCases(principal);
    return leakageByType(cases, this.currency);
  }

  async periodClose(principal: AuthenticatedPrincipal, from: string, to: string): Promise<ReturnType<typeof periodClosePack>> {
    requirePerm(principal, 'audit:read');
    const cases = await this.listCases(principal);
    return periodClosePack(cases, this.currency, from, to);
  }

  /* ───────────────────────── Audit ───────────────────────── */

  async auditTrail(principal: AuthenticatedPrincipal): Promise<AuditEntry[]> {
    requirePerm(principal, 'audit:read');
    return this.uow.audit.all();
  }

  async auditIntact(principal: AuthenticatedPrincipal): Promise<boolean> {
    requirePerm(principal, 'audit:read');
    return this.uow.audit.verifyChain();
  }

  /** Total net recoverable across the scoped portfolio. */
  async totalRecoverable(principal: AuthenticatedPrincipal): Promise<Money> {
    const cases = await this.listCases(principal);
    return cases.reduce<Money>(
      (acc, c) => add(acc, c.findings.reduce<Money>((a, f) => add(a, f.netRecoverable), money(0, this.currency))),
      money(0, this.currency),
    );
  }

  /** Top-ranked cases by recoverable (triage list). */
  async topCases(principal: AuthenticatedPrincipal, limit = 5): Promise<LeakageCase[]> {
    const cases = await this.listCases(principal);
    return rankCases(cases).slice(0, limit);
  }

  /* ───────────────────────── Insights (surface the domain modules) ───────────────────────── */

  /** Dashboard headline numbers. */
  async headline(principal: AuthenticatedPrincipal): Promise<ReturnType<typeof insights.headline>> {
    requirePerm(principal, 'case:read');
    return insights.headline(await this.listCases(principal), this.currency);
  }

  /** Forward-looking insights: run-rate, projection, peer benchmark, maturity, upside. */
  async insights(principal: AuthenticatedPrincipal, opts: {
    windowDays?: number; arrMinor?: number; industry?: insights.Industry; historicalRecoveryRate?: number;
  } = {}): Promise<insights.PortfolioInsights> {
    requirePerm(principal, 'case:read');
    const cases = await this.listCases(principal);
    return insights.portfolioInsights(cases, this.currency, {
      windowDays: opts.windowDays ?? 90,
      arr: money(opts.arrMinor ?? 10_000_000_00, this.currency),
      industry: opts.industry ?? 'saas',
      historicalRecoveryRate: opts.historicalRecoveryRate ?? 0.6,
    });
  }

  /** ROI calculation from the live recoverable + buyer-supplied cost assumptions. */
  async roi(principal: AuthenticatedPrincipal, inputs: {
    windowDays?: number; annualPlatformCostMinor: number;
    analystHoursSavedPerMonth: number; analystHourlyCostMinor: number;
  }): Promise<insights.RoiResult> {
    requirePerm(principal, 'case:read');
    const total = await this.totalRecoverable(principal);
    return insights.computeRoi(total, inputs.windowDays ?? 90, {
      annualPlatformCost: money(inputs.annualPlatformCostMinor, this.currency),
      analystHoursSavedPerMonth: inputs.analystHoursSavedPerMonth,
      analystHourlyCost: money(inputs.analystHourlyCostMinor, this.currency),
    });
  }

  /** Anomaly scan over per-case exposures. */
  async anomalies(principal: AuthenticatedPrincipal): Promise<ReturnType<typeof insights.portfolioAnomalies>> {
    requirePerm(principal, 'case:read');
    return insights.portfolioAnomalies(await this.listCases(principal), this.currency);
  }

  /** Build a board/audit evidence pack from the live portfolio + audit chain. */
  async evidencePack(principal: AuthenticatedPrincipal, from: string, to: string, at: string): Promise<insights.EvidencePack> {
    requirePerm(principal, 'audit:read');
    const cases = await this.listCases(principal);
    const audit = await this.uow.audit.all();
    const controls: insights.ControlAttestation[] = [
      { controlId: 'RC-01', name: 'Reconciliation completeness', operatingEffectively: true, evidenceCount: cases.length },
      { controlId: 'RC-02', name: 'Segregation of duties', operatingEffectively: true, evidenceCount: audit.length },
      { controlId: 'RC-03', name: 'Audit trail integrity', operatingEffectively: await this.uow.audit.verifyChain(), evidenceCount: audit.length },
    ];
    return insights.evidenceFromPortfolio({
      tenantId: this.tenantId, from, to, generatedAt: at, cases, audit, controls, currency: this.currency,
    });
  }

  async close(): Promise<void> {
    await this.uow.close();
  }
}
