/**
 * Deterministic reconciliation core (S50 — Block R foundation).
 *
 * THE architectural heart: this engine decides what is leakage and how much is recoverable.
 * An LLM may *explain* a finding, but it never decides one — every number here is computed by
 * total, deterministic functions over typed inputs, so the same inputs always yield the same
 * case. That reproducibility is what makes the audit trail and the evidence pack defensible.
 *
 * The net-recoverable legal model: a detected gross variance is discounted to the amount that is
 * actually, legally recoverable (statute-of-limitations age decay + a contractual-strength
 * factor). We never claim more than the model says is collectible.
 */
import { money, subtract, compare, type Money } from '../money/money.ts';
import type { LeakageCase, VarianceFinding, LeakageType } from '../core/model.ts';

export class ReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReconciliationError';
  }
}

/**
 * The structured input a detector (Work IQ, amendment diff, usage, tax, …) hands the
 * reconciliation engine. `expected` is the contractual amount, `actual` the billed amount.
 */
export interface VarianceInput {
  readonly id: string;
  readonly type: LeakageType;
  readonly expected: Money;
  readonly actual: Money;
  /** Detection confidence, 0..1. */
  readonly confidence: number;
  /** Age of the underlying obligation in days (drives statute-of-limitations decay). */
  readonly ageDays: number;
  /** Contractual-strength factor 0..1 (1 = airtight machine-readable clause). */
  readonly contractStrength?: number;
  readonly field?: string;
  readonly name?: string;
}

/** Statute-of-limitations window (days) beyond which recovery is presumed time-barred. */
export const RECOVERY_WINDOW_DAYS = 6 * 365;

/**
 * The net-recoverable legal model. Gross = max(expected − actual, 0). The recoverable fraction
 * decays linearly to zero at the recovery window and is scaled by contractual strength. Confidence
 * is a *gate* applied upstream (a signal is admitted or not), not a linear haircut on the amount —
 * we don't tell a CFO "we'll claim 95% because we're 95% sure". Returns whole minor units.
 */
export function netRecoverable(v: VarianceInput): Money {
  const gross = grossDetected(v);
  if (gross.amount <= 0) return money(0, gross.currency);
  // Validate confidence is well-formed even though it does not scale the amount.
  clamp01(v.confidence);
  const ageFactor = v.ageDays >= RECOVERY_WINDOW_DAYS ? 0 : 1 - v.ageDays / RECOVERY_WINDOW_DAYS;
  const strength = v.contractStrength ?? 1;
  const fraction = ageFactor * strength;
  return { amount: Math.round(gross.amount * fraction), currency: gross.currency };
}

/** Gross detected variance: max(expected − actual, 0), same currency. */
export function grossDetected(v: VarianceInput): Money {
  const diff = subtract(v.expected, v.actual);
  return diff.amount > 0 ? diff : money(0, diff.currency);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) throw new ReconciliationError(`confidence must be finite, got ${x}`);
  return Math.max(0, Math.min(1, x));
}

/**
 * Turn a variance input into a finding, applying the net-recoverable model. Returns null when
 * nothing is recoverable (no gross, or fully time-barred) — the engine does not raise empty cases.
 */
export function buildFinding(v: VarianceInput): VarianceFinding | null {
  const gross = grossDetected(v);
  if (gross.amount <= 0) return null;
  const net = netRecoverable(v);
  if (net.amount <= 0) return null;
  return {
    id: v.id,
    type: v.type,
    netRecoverable: net,
    grossDetected: gross,
    expected: v.expected,
    actual: v.actual,
    confidence: clamp01(v.confidence),
    ...(v.field !== undefined ? { field: v.field } : {}),
    ...(v.name !== undefined ? { name: v.name } : {}),
  };
}

/** Total net-recoverable across a case's findings (same currency; empty → throws). */
export function caseNetRecoverable(c: LeakageCase): Money {
  if (c.findings.length === 0) throw new ReconciliationError(`Case ${c.id} has no findings`);
  return c.findings.reduce<Money>(
    (acc, f) => ({ amount: acc.amount + f.netRecoverable.amount, currency: f.netRecoverable.currency }),
    money(0, c.findings[0]!.netRecoverable.currency),
  );
}

/**
 * Create a leakage case from findings. Deduplicates findings by id (a detector firing twice on
 * the same obligation must not double-count). Status starts 'open'.
 */
export function createCase(id: string, customerId: string, findings: VarianceFinding[], at: string): LeakageCase {
  if (findings.length === 0) throw new ReconciliationError('A case requires at least one finding');
  const seen = new Set<string>();
  const deduped: VarianceFinding[] = [];
  for (const f of findings) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    deduped.push(f);
  }
  return { id, customerId, findings: deduped, status: 'open', createdAt: at };
}

/**
 * Rank cases by net-recoverable descending (largest leakage first), tie-broken by createdAt then
 * id for a stable, reproducible order. Cases are assumed same-currency within a tenant.
 */
export function rankCases(cases: LeakageCase[]): LeakageCase[] {
  return [...cases].sort((a, b) => {
    const an = sumNet(a);
    const bn = sumNet(b);
    if (an !== bn) return bn - an;
    const t = a.createdAt.localeCompare(b.createdAt);
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });
}

function sumNet(c: LeakageCase): number {
  return c.findings.reduce((s, f) => s + f.netRecoverable.amount, 0);
}

/** True iff a's net recoverable exceeds b's (currency-checked). */
export function moreRecoverable(a: VarianceFinding, b: VarianceFinding): boolean {
  return compare(a.netRecoverable, b.netRecoverable) > 0;
}
