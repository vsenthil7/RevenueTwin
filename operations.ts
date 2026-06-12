/**
 * Bulk operations & scale (S20).
 *
 * Real revenue teams triage hundreds of cases. This module adds saved filters, sorting,
 * pagination, and batch decisions that apply the SAME safety rules as single-case actions —
 * every batch decision returns a per-item result, so a failure in one item never silently
 * affects another, and approvals still flow through the action layer's gate downstream.
 */
import { money, add, compare, type Money } from '../money/money.ts';
import type { LeakageCase, CaseStatus, LeakageType, Decision } from '../core/model.ts';

export class BulkError extends Error {
  constructor(message: string) { super(message); this.name = 'BulkError'; }
}

/** Saved/ad-hoc filter over cases. All fields optional (AND-combined). */
export interface CaseFilter {
  status?: CaseStatus;
  customerId?: string;
  detectedViaWorkIQ?: boolean;
  type?: LeakageType;
  minNetRecoverable?: Money;
}

function caseNet(c: LeakageCase, currency: string): Money {
  return c.findings.reduce<Money>((acc, f) => add(acc, f.netRecoverable), money(0, currency));
}

export function applyFilter(cases: LeakageCase[], filter: CaseFilter, currency: string): LeakageCase[] {
  return cases.filter((c) => {
    if (filter.status !== undefined && c.status !== filter.status) return false;
    if (filter.customerId !== undefined && c.customerId !== filter.customerId) return false;
    if (filter.detectedViaWorkIQ !== undefined && c.detectedViaWorkIQ !== filter.detectedViaWorkIQ) return false;
    if (filter.type !== undefined && !c.findings.some((f) => f.type === filter.type)) return false;
    if (filter.minNetRecoverable !== undefined && compare(caseNet(c, currency), filter.minNetRecoverable) < 0) return false;
    return true;
  });
}

export type SortKey = 'netRecoverable' | 'createdAt';

export function sortCases(cases: LeakageCase[], key: SortKey, dir: 'asc' | 'desc', currency: string): LeakageCase[] {
  const sorted = [...cases].sort((a, b) => {
    let cmp: number;
    if (key === 'netRecoverable') {
      cmp = compare(caseNet(a, currency), caseNet(b, currency));
    } else {
      cmp = a.createdAt.localeCompare(b.createdAt);
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  if (page < 1) throw new BulkError(`page must be >= 1, got ${page}`);
  if (pageSize < 1) throw new BulkError(`pageSize must be >= 1, got ${pageSize}`);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page, pageSize, total, totalPages };
}

/** A query combining filter + sort + pagination — the saved-view primitive. */
export interface CaseQuery {
  filter?: CaseFilter;
  sort?: { key: SortKey; dir: 'asc' | 'desc' };
  page?: number;
  pageSize?: number;
}

export function runQuery(cases: LeakageCase[], q: CaseQuery, currency: string): Page<LeakageCase> {
  let result = q.filter ? applyFilter(cases, q.filter, currency) : [...cases];
  if (q.sort) result = sortCases(result, q.sort.key, q.sort.dir, currency);
  return paginate(result, q.page ?? 1, q.pageSize ?? 50);
}

/* ───────────────────────── Batch decisions ───────────────────────── */

export interface BatchDecisionItem { caseId: string; decision: Decision; }
export interface BatchDecisionResult {
  caseId: string;
  ok: boolean;
  applied?: Decision;
  reason?: string;
}

/**
 * Apply a decision to many cases. Each item is independent: an invalid decision or unknown case
 * fails only that item. Returns a per-item result list. Only 'approve' on an 'open' or
 * 'escalated' case transitions it here; the actual money write still flows through the action
 * layer + billing service downstream (this records the triage decision).
 */
export function batchDecide(
  cases: Map<string, LeakageCase>,
  items: BatchDecisionItem[],
): BatchDecisionResult[] {
  const results: BatchDecisionResult[] = [];
  for (const item of items) {
    const c = cases.get(item.caseId);
    if (!c) {
      results.push({ caseId: item.caseId, ok: false, reason: 'not found' });
      continue;
    }
    if (c.status !== 'open' && c.status !== 'escalated') {
      results.push({ caseId: item.caseId, ok: false, reason: `not actionable in status ${c.status}` });
      continue;
    }
    let next: CaseStatus | null = null;
    if (item.decision === 'approve') next = 'approved';
    else if (item.decision === 'reject') next = 'rejected';
    else if (item.decision === 'escalate') next = 'escalated';
    // 'edit' is a no-op transition here (requires single-case editing UI)
    if (next === null) {
      results.push({ caseId: item.caseId, ok: false, reason: `decision '${item.decision}' not supported in bulk` });
      continue;
    }
    c.status = next;
    results.push({ caseId: item.caseId, ok: true, applied: item.decision });
  }
  return results;
}

/** Summary of a batch run. */
export interface BatchSummary { total: number; succeeded: number; failed: number; }

export function summarizeBatch(results: BatchDecisionResult[]): BatchSummary {
  let succeeded = 0;
  for (const r of results) if (r.ok) succeeded += 1;
  return { total: results.length, succeeded, failed: results.length - succeeded };
}
