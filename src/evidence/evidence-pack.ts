/**
 * Evidence pack generation (S32).
 *
 * Assembles a structured, self-describing evidence bundle for auditors and the board: the cases,
 * decisions, audit entries, control attestations, and a content hash for integrity. Deterministic
 * given inputs; the hash lets a recipient verify the pack wasn't altered after generation.
 */
import { createHash } from 'node:crypto';
import { toDecimal, type Money } from '../money/money.ts';
import type { AuditEntry } from '../core/audit.ts';
import type { LeakageCase } from '../core/model.ts';

export class EvidenceError extends Error {
  constructor(message: string) { super(message); this.name = 'EvidenceError'; }
}

export interface ControlAttestation {
  readonly controlId: string;
  readonly name: string;
  readonly operatingEffectively: boolean;
  readonly evidenceCount: number;
}

export interface EvidenceCaseSummary {
  readonly caseId: string;
  readonly customerId: string;
  readonly status: string;
  readonly netRecoverableMajor: number;
  readonly detectedViaWorkIQ: boolean;
}

export interface EvidencePack {
  readonly tenantId: string;
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly generatedAt: string;
  readonly cases: EvidenceCaseSummary[];
  readonly auditEntryCount: number;
  readonly auditHeadHash: string;
  readonly controls: ControlAttestation[];
  readonly totals: { totalCases: number; totalRecoverableMajor: number; currency: string };
  readonly contentHash: string;
}

function caseNetMajor(c: LeakageCase): number {
  let minor = 0;
  let currency = 'GBP';
  for (const f of c.findings) { minor += f.netRecoverable.amount; currency = f.netRecoverable.currency; }
  return toDecimal({ amount: minor, currency });
}

/**
 * Build an evidence pack. The content hash covers everything except itself, so a recipient can
 * recompute and verify. Audit head hash ties the pack to the tamper-evident chain.
 */
export function buildEvidencePack(args: {
  tenantId: string;
  periodFrom: string;
  periodTo: string;
  generatedAt: string;
  cases: LeakageCase[];
  auditEntries: AuditEntry[];
  controls: ControlAttestation[];
  currency: string;
}): EvidencePack {
  if (Date.parse(args.periodFrom) > Date.parse(args.periodTo)) {
    throw new EvidenceError('periodFrom is after periodTo');
  }
  const caseSummaries: EvidenceCaseSummary[] = args.cases.map((c) => ({
    caseId: c.id, customerId: c.customerId, status: c.status,
    netRecoverableMajor: caseNetMajor(c), detectedViaWorkIQ: c.detectedViaWorkIQ,
  }));
  const totalRecoverableMajor = caseSummaries.reduce((s, c) => s + c.netRecoverableMajor, 0);
  const auditHeadHash = args.auditEntries.length === 0
    ? '0'.repeat(64)
    : args.auditEntries[args.auditEntries.length - 1]!.hash;

  const body = {
    tenantId: args.tenantId,
    periodFrom: args.periodFrom,
    periodTo: args.periodTo,
    generatedAt: args.generatedAt,
    cases: caseSummaries,
    auditEntryCount: args.auditEntries.length,
    auditHeadHash,
    controls: args.controls,
    totals: {
      totalCases: caseSummaries.length,
      totalRecoverableMajor: Math.round(totalRecoverableMajor * 100) / 100,
      currency: args.currency,
    },
  };
  const contentHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return { ...body, contentHash };
}

/** Verify a pack's integrity by recomputing its content hash. */
export function verifyEvidencePack(pack: EvidencePack): boolean {
  const { contentHash, ...body } = pack;
  const recomputed = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return recomputed === contentHash;
}

/** Count how many controls in the pack are attested as operating effectively. */
export function effectiveControlCount(pack: EvidencePack): number {
  return pack.controls.filter((c) => c.operatingEffectively).length;
}

/** Are all controls operating effectively (clean attestation)? */
export function isCleanAttestation(pack: EvidencePack): boolean {
  return pack.controls.length > 0 && pack.controls.every((c) => c.operatingEffectively);
}
