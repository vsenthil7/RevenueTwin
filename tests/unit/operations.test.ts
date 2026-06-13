import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BulkError, applyFilter, sortCases, paginate, runQuery, batchDecide, summarizeBatch,
  type BatchDecisionItem,
} from '../../src/bulk/operations.ts';
import { money } from '../../src/money/money.ts';
import type { LeakageCase, CaseStatus, LeakageType } from '../../src/core/model.ts';

function caseOf(
  id: string, status: CaseStatus, net: number,
  opts: { customerId?: string; workIQ?: boolean; createdAt?: string; type?: LeakageType } = {},
): LeakageCase {
  return {
    id, customerId: opts.customerId ?? 'acme', status, createdAt: opts.createdAt ?? '2026-01-15',
    findings: [{ id: `${id}-f`, type: opts.type ?? 'intent', netRecoverable: money(net, 'GBP') }],
    ...(opts.workIQ !== undefined ? { detectedViaWorkIQ: opts.workIQ } : {}),
  };
}

const portfolio = [
  caseOf('a', 'open', 500_00, { customerId: 'acme', workIQ: true, type: 'intent', createdAt: '2026-01-10' }),
  caseOf('b', 'approved', 300_00, { customerId: 'globex', type: 'tax', createdAt: '2026-01-20' }),
  caseOf('c', 'open', 100_00, { customerId: 'acme', type: 'intent', createdAt: '2026-01-05' }),
];

test('applyFilter combines predicates (AND)', () => {
  assert.equal(applyFilter(portfolio, { status: 'open' }, 'GBP').length, 2);
  assert.equal(applyFilter(portfolio, { customerId: 'globex' }, 'GBP').length, 1);
  assert.equal(applyFilter(portfolio, { detectedViaWorkIQ: true }, 'GBP').length, 1);
  assert.equal(applyFilter(portfolio, { type: 'tax' }, 'GBP').length, 1);
  assert.equal(applyFilter(portfolio, { minNetRecoverable: money(200_00, 'GBP') }, 'GBP').length, 2);
  // combined
  assert.equal(applyFilter(portfolio, { status: 'open', customerId: 'acme', type: 'intent' }, 'GBP').length, 2);
  // empty filter returns all
  assert.equal(applyFilter(portfolio, {}, 'GBP').length, 3);
});

test('sortCases by netRecoverable and createdAt, both directions', () => {
  assert.deepEqual(sortCases(portfolio, 'netRecoverable', 'desc', 'GBP').map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(sortCases(portfolio, 'netRecoverable', 'asc', 'GBP').map((c) => c.id), ['c', 'b', 'a']);
  assert.deepEqual(sortCases(portfolio, 'createdAt', 'asc', 'GBP').map((c) => c.id), ['c', 'a', 'b']);
  assert.deepEqual(sortCases(portfolio, 'createdAt', 'desc', 'GBP').map((c) => c.id), ['b', 'a', 'c']);
});

test('paginate slices and reports totals', () => {
  const p = paginate([1, 2, 3, 4, 5], 1, 2);
  assert.deepEqual(p.items, [1, 2]);
  assert.equal(p.total, 5);
  assert.equal(p.totalPages, 3);
  assert.deepEqual(paginate([1, 2, 3, 4, 5], 3, 2).items, [5]);
  // empty -> at least 1 page
  assert.equal(paginate([], 1, 10).totalPages, 1);
});

test('paginate validates page and pageSize', () => {
  assert.throws(() => paginate([1], 0, 10), BulkError);
  assert.throws(() => paginate([1], 1, 0), BulkError);
});

test('runQuery combines filter + sort + pagination, and defaults', () => {
  const page = runQuery(portfolio, { filter: { status: 'open' }, sort: { key: 'netRecoverable', dir: 'desc' }, page: 1, pageSize: 1 }, 'GBP');
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]!.id, 'a'); // largest open
  assert.equal(page.total, 2);
  // no filter / no sort -> all cases, default page/size
  const all = runQuery(portfolio, {}, 'GBP');
  assert.equal(all.total, 3);
  assert.equal(all.page, 1);
});

test('batchDecide applies independent per-item decisions', () => {
  const map = new Map(portfolio.map((c) => [c.id, { ...c, findings: [...c.findings] }]));
  const items: BatchDecisionItem[] = [
    { caseId: 'a', decision: 'approve' },
    { caseId: 'c', decision: 'reject' },
    { caseId: 'b', decision: 'approve' },        // not actionable (already approved)
    { caseId: 'missing', decision: 'approve' },  // not found
  ];
  const results = batchDecide(map, items);
  assert.equal(results.find((r) => r.caseId === 'a')!.ok, true);
  assert.equal(map.get('a')!.status, 'approved');
  assert.equal(results.find((r) => r.caseId === 'c')!.ok, true);
  assert.equal(map.get('c')!.status, 'rejected');
  assert.equal(results.find((r) => r.caseId === 'b')!.ok, false);
  assert.match(results.find((r) => r.caseId === 'b')!.reason!, /not actionable/);
  assert.equal(results.find((r) => r.caseId === 'missing')!.ok, false);
});

test('batchDecide escalate transition and escalated-status actionability', () => {
  const map = new Map([
    ['e', { ...caseOf('e', 'escalated', 100_00) }],
    ['o', { ...caseOf('o', 'open', 100_00) }],
  ]);
  const results = batchDecide(map, [
    { caseId: 'e', decision: 'approve' }, // escalated is actionable
    { caseId: 'o', decision: 'escalate' },
  ]);
  assert.equal(results[0]!.ok, true);
  assert.equal(map.get('e')!.status, 'approved');
  assert.equal(results[1]!.ok, true);
  assert.equal(map.get('o')!.status, 'escalated');
});

test('batchDecide rejects an unsupported decision value', () => {
  const map = new Map([['o', { ...caseOf('o', 'open', 100_00) }]]);
  // cast an out-of-enum decision to hit the "not supported in bulk" branch
  const results = batchDecide(map, [{ caseId: 'o', decision: 'edit' as unknown as 'approve' }]);
  assert.equal(results[0]!.ok, false);
  assert.match(results[0]!.reason!, /not supported in bulk/);
});

test('summarizeBatch counts succeeded and failed', () => {
  const summary = summarizeBatch([
    { caseId: 'a', ok: true, applied: 'approve' },
    { caseId: 'b', ok: false, reason: 'x' },
    { caseId: 'c', ok: true, applied: 'reject' },
  ]);
  assert.deepEqual(summary, { total: 3, succeeded: 2, failed: 1 });
});
