/**
 * Scheduled re-scan diff (S73).
 *
 * Turns a one-shot reconciliation into a standing watchdog: given the previous scan baseline
 * and a fresh scan, compute what changed since last time - new leakage, resolved leakage, and
 * cases whose recoverable amount grew or shrank. Pure + deterministic; the scheduler decides
 * WHEN to run, this decides WHAT changed, and the alert layer decides whether to notify.
 */
import type { LeakageCase } from '../core/model.ts';

function caseNet(c: LeakageCase): number {
  return c.findings.reduce((s, f) => s + f.netRecoverable.amount, 0);
}

export interface RescanDelta {
  readonly caseId: string;
  readonly customerId: string;
  readonly kind: 'new' | 'resolved' | 'grown' | 'shrunk';
  readonly previousMinor: number;
  readonly currentMinor: number;
  readonly deltaMinor: number;
}

export interface RescanResult {
  readonly deltas: RescanDelta[];
  readonly newLeakageMinor: number;
  readonly resolvedLeakageMinor: number;
  readonly netChangeMinor: number;
  readonly hasChanges: boolean;
}

/** Compute the diff between a baseline scan and a fresh scan. */
export function diffScans(baseline: readonly LeakageCase[], current: readonly LeakageCase[]): RescanResult {
  const prev = new Map<string, LeakageCase>();
  for (const c of baseline) prev.set(c.id, c);
  const curr = new Map<string, LeakageCase>();
  for (const c of current) curr.set(c.id, c);
  const deltas: RescanDelta[] = [];
  // New or changed cases (iterate current).
  for (const c of current) {
    const before = prev.get(c.id);
    const currentMinor = caseNet(c);
    if (!before) {
      deltas.push({ caseId: c.id, customerId: c.customerId, kind: 'new', previousMinor: 0, currentMinor, deltaMinor: currentMinor });
      continue;
    }
    const previousMinor = caseNet(before);
    if (currentMinor > previousMinor) {
      deltas.push({ caseId: c.id, customerId: c.customerId, kind: 'grown', previousMinor, currentMinor, deltaMinor: currentMinor - previousMinor });
    } else if (currentMinor < previousMinor) {
      deltas.push({ caseId: c.id, customerId: c.customerId, kind: 'shrunk', previousMinor, currentMinor, deltaMinor: currentMinor - previousMinor });
    }
  }
  // Resolved cases (in baseline, absent now).
  for (const c of baseline) {
    if (!curr.has(c.id)) {
      const previousMinor = caseNet(c);
      deltas.push({ caseId: c.id, customerId: c.customerId, kind: 'resolved', previousMinor, currentMinor: 0, deltaMinor: -previousMinor });
    }
  }
  // Totals: new leakage = sum of increases (new + grown); resolved = sum of decreases (resolved + shrunk).
  let newLeakageMinor = 0;
  let resolvedLeakageMinor = 0;
  for (const dlt of deltas) {
    if (dlt.deltaMinor > 0) newLeakageMinor += dlt.deltaMinor;
    else resolvedLeakageMinor += -dlt.deltaMinor;
  }
  return {
    deltas,
    newLeakageMinor,
    resolvedLeakageMinor,
    netChangeMinor: newLeakageMinor - resolvedLeakageMinor,
    hasChanges: deltas.length > 0,
  };
}
