/**
 * Bootstrap (integration).
 *
 * Assembles a ready-to-serve RevenueTwinApp: provisions demo users across roles and seeds the
 * Northwind Golden-Thread leak through the REAL reconciliation + Work IQ path (not a hardcoded
 * row), so the running server demonstrates the moat end-to-end. Storage is injected so this same
 * bootstrap runs in-memory (demo) or against postgres (production) unchanged.
 */
import { MemoryUnitOfWork } from '../persistence/memory-adapter.ts';
import { selectUnitOfWork } from './persistence-factory.ts';
import type { UnitOfWork } from '../persistence/repository.ts';
import { UserStore } from '../identity/rbac.ts';
import { RevenueTwinApp } from './application.ts';
import { NORTHWIND } from '../core/golden-thread.ts';
import { intentVarianceInput, WORKIQ_ON, WORKIQ_OFF } from '../intent/workiq.ts';
import { buildFinding } from '../core/reconciliation.ts';
import type { VarianceFinding } from '../core/model.ts';

export interface BootstrapResult {
  app: RevenueTwinApp;
  users: UserStore;
  uow: UnitOfWork;
  backend: 'memory' | 'postgres';
}

/** Provision a standard set of demo users spanning the main roles. */
export function seedUsers(): UserStore {
  const users = new UserStore();
  users.provision({ id: 'cfo', email: 'cfo@northwind.example', roles: ['cfo'], allowedCustomers: '*', active: true });
  users.provision({ id: 'controller', email: 'controller@northwind.example', roles: ['controller'], allowedCustomers: '*', active: true });
  users.provision({ id: 'revops', email: 'revops@northwind.example', roles: ['revops'], allowedCustomers: ['northwind'], active: true });
  users.provision({ id: 'auditor', email: 'auditor@northwind.example', roles: ['auditor'], allowedCustomers: '*', active: true });
  users.provision({ id: 'admin', email: 'admin@northwind.example', roles: ['admin'], allowedCustomers: '*', active: true });
  return users;
}

/**
 * Reconcile the Northwind scenario with Work IQ on, returning the intent-driven finding(s).
 * This is the exact leak the moat exists to catch: a 12% uplift agreed at QBR, never billed.
 */
export function northwindFindings(workIQOn = true): VarianceFinding[] {
  const cfg = workIQOn ? WORKIQ_ON : WORKIQ_OFF;
  const v = intentVarianceInput(NORTHWIND.qbrEvent, NORTHWIND.term, NORTHWIND.billedUplift, NORTHWIND.ageDays, cfg);
  if (!v) return [];
  // A valid above-threshold intent variance always yields a finding (invariant of NORTHWIND).
  return [buildFinding(v)!];
}

/**
 * Build a seeded app. `seedCase` controls whether the Northwind leak is pre-loaded as a case.
 * Uses an injected UnitOfWork (defaults to in-memory).
 */
export async function bootstrap(opts: {
  uow?: UnitOfWork;
  tenantId?: string;
  currency?: string;
  seedCase?: boolean;
  clock?: () => string;
  databaseUrl?: string;
  backend?: 'memory' | 'postgres';
  pgClientFactory?: import('./persistence-factory.ts').PgClientFactory;
  forceMemory?: boolean;
} = {}): Promise<BootstrapResult> {
  const tenantId = opts.tenantId ?? 'northwind-tenant';
  const currency = opts.currency ?? 'GBP';
  // Persistence selection: explicit uow wins; otherwise select by backend/DATABASE_URL (S59).
  const selected = opts.uow
    ? { uow: opts.uow, backend: 'memory' as const }
    : selectUnitOfWork({ tenantId, databaseUrl: opts.databaseUrl, backend: opts.backend, forceMemory: opts.forceMemory, pgClientFactory: opts.pgClientFactory });
  const uow = selected.uow;
  const users = seedUsers();
  const app = new RevenueTwinApp(uow, { tenantId, currency }, opts.clock);

  if (opts.seedCase !== false) {
    const cfo = users.authenticate('cfo');
    // The Golden Thread leak: Work IQ intent, detected via the real reconciliation path.
    const findings = northwindFindings(true);
    if (findings.length > 0) {
      await app.openCase(cfo, NORTHWIND.customerId, findings, true, '2026-04-02T00:00:00.000Z');
    }
    // A realistic structural portfolio so the dashboard shows depth (not a single row).
    const f = (id: string, type: VarianceFinding['type'], net: number, conf: number): VarianceFinding => ({
      id, type, expected: { amount: net, currency }, actual: { amount: 0, currency },
      grossDetected: { amount: net, currency }, netRecoverable: { amount: net, currency }, confidence: conf,
    });
    const seedCases: { customer: string; findings: VarianceFinding[]; at: string }[] = [
      { customer: 'acme-corp', findings: [f('acme-1', 'missed_escalator', 3_600_000, 0.95)], at: '2026-04-05T00:00:00.000Z' },
      { customer: 'globex', findings: [f('globex-1', 'expired_discount', 2_800_000, 0.91)], at: '2026-04-11T00:00:00.000Z' },
      { customer: 'initech', findings: [f('initech-1', 'unbilled_usage', 5_400_000, 0.88)], at: '2026-05-02T00:00:00.000Z' },
      { customer: 'umbrella', findings: [f('umbrella-1', 'dunning_gap', 1_900_000, 0.84)], at: '2026-05-09T00:00:00.000Z' },
      { customer: 'soylent', findings: [f('soylent-1', 'pricing_config', 9_200_000, 0.93)], at: '2026-05-20T00:00:00.000Z' },
    ];
    for (const sc of seedCases) {
      await app.openCase(cfo, sc.customer, sc.findings, false, sc.at);
    }
  }
  return { app, users, uow, backend: selected.backend };
}
