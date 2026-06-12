import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  netRecoverable, grossDetected, buildFinding, caseNetRecoverable,
  createCase, rankCases, moreRecoverable, ReconciliationError,
  RECOVERY_WINDOW_DAYS, type VarianceInput,
} from '../../src/core/reconciliation.ts';
import { money } from '../../src/money/money.ts';
import type { LeakageCase, VarianceFinding } from '../../src/core/model.ts';

function input(over: Partial<VarianceInput> = {}): VarianceInput {
  return {
    id: 'v1', type: 'price_changed',
    expected: money(1100_00, 'GBP'), actual: money(1000_00, 'GBP'),
    confidence: 1, ageDays: 0, contractStrength: 1, ...over,
  };
}

test('grossDetected is max(expected - actual, 0)', () => {
  assert.equal(grossDetected(input()).amount, 100_00);
  assert.equal(grossDetected(input({ expected: money(100, 'GBP'), actual: money(500, 'GBP') })).amount, 0);
});

test('netRecoverable equals gross at age 0, full confidence and strength', () => {
  assert.equal(netRecoverable(input()).amount, 100_00);
});

test('netRecoverable decays with age and is zero at/after the window', () => {
  const half = netRecoverable(input({ ageDays: RECOVERY_WINDOW_DAYS / 2 }));
  assert.equal(half.amount, Math.round(100_00 * 0.5));
  assert.equal(netRecoverable(input({ ageDays: RECOVERY_WINDOW_DAYS })).amount, 0);
  assert.equal(netRecoverable(input({ ageDays: RECOVERY_WINDOW_DAYS + 100 })).amount, 0);
});

test('netRecoverable scales by contract strength (confidence does NOT scale amount)', () => {
  assert.equal(netRecoverable(input({ confidence: 0.5 })).amount, 100_00); // confidence is a gate, not a haircut
  assert.equal(netRecoverable(input({ contractStrength: 0.5 })).amount, 50_00);
  // strength defaults to 1 when omitted
  assert.equal(netRecoverable(input({ contractStrength: undefined })).amount, 100_00);
});

test('netRecoverable validates confidence into 0..1 but does not scale by it', () => {
  assert.equal(netRecoverable(input({ confidence: 5 })).amount, 100_00);
  assert.equal(netRecoverable(input({ confidence: -1 })).amount, 100_00);
});

test('netRecoverable returns zero when there is no gross', () => {
  assert.equal(netRecoverable(input({ expected: money(100, 'GBP'), actual: money(100, 'GBP') })).amount, 0);
});

test('netRecoverable rejects non-finite confidence', () => {
  assert.throws(() => netRecoverable(input({ confidence: Number.NaN })), ReconciliationError);
});

test('buildFinding produces a finding with gross + net', () => {
  const f = buildFinding(input({ field: 'unitPrice', name: 'Uplift' }));
  assert.ok(f);
  assert.equal(f!.netRecoverable.amount, 100_00);
  assert.equal(f!.grossDetected!.amount, 100_00);
  assert.equal(f!.field, 'unitPrice');
  assert.equal(f!.name, 'Uplift');
  assert.equal(f!.confidence, 1);
});

test('buildFinding omits field/name when not provided', () => {
  const f = buildFinding(input());
  assert.equal(f!.field, undefined);
  assert.equal(f!.name, undefined);
});

test('buildFinding returns null when no gross', () => {
  assert.equal(buildFinding(input({ expected: money(100, 'GBP'), actual: money(100, 'GBP') })), null);
});

test('buildFinding returns null when fully time-barred', () => {
  assert.equal(buildFinding(input({ ageDays: RECOVERY_WINDOW_DAYS })), null);
});

test('createCase dedupes findings by id, starts open', () => {
  const f: VarianceFinding = { id: 'f1', type: 'intent', netRecoverable: money(500_00, 'GBP') };
  const c = createCase('case1', 'cust1', [f, f, { ...f, id: 'f2' }], '2026-01-01');
  assert.equal(c.findings.length, 2);
  assert.equal(c.status, 'open');
  assert.equal(c.customerId, 'cust1');
});

test('createCase rejects empty findings', () => {
  assert.throws(() => createCase('c', 'cust', [], '2026-01-01'), ReconciliationError);
});

test('caseNetRecoverable sums findings', () => {
  const c: LeakageCase = {
    id: 'c1', customerId: 'cust', status: 'open', createdAt: '2026-01-01',
    findings: [
      { id: 'a', type: 'intent', netRecoverable: money(300_00, 'GBP') },
      { id: 'b', type: 'tax', netRecoverable: money(200_00, 'GBP') },
    ],
  };
  assert.equal(caseNetRecoverable(c).amount, 500_00);
});

test('caseNetRecoverable throws on empty case', () => {
  const c: LeakageCase = { id: 'c', customerId: 'x', status: 'open', createdAt: '2026-01-01', findings: [] };
  assert.throws(() => caseNetRecoverable(c), ReconciliationError);
});

function caseOf(id: string, net: number, at: string): LeakageCase {
  return { id, customerId: 'cust', status: 'open', createdAt: at, findings: [{ id: `${id}-f`, type: 'intent', netRecoverable: money(net, 'GBP') }] };
}

test('rankCases orders by net recoverable desc', () => {
  const ranked = rankCases([caseOf('a', 100, 't1'), caseOf('b', 300, 't2'), caseOf('c', 200, 't3')]);
  assert.deepEqual(ranked.map((c) => c.id), ['b', 'c', 'a']);
});

test('rankCases tie-breaks by createdAt then id', () => {
  const ranked = rankCases([caseOf('z', 100, '2026-02-01'), caseOf('a', 100, '2026-01-01'), caseOf('m', 100, '2026-01-01')]);
  // same net: earliest createdAt first; within same createdAt, id asc
  assert.deepEqual(ranked.map((c) => c.id), ['a', 'm', 'z']);
});

test('moreRecoverable compares net recoverable', () => {
  const a: VarianceFinding = { id: 'a', type: 'intent', netRecoverable: money(300_00, 'GBP') };
  const b: VarianceFinding = { id: 'b', type: 'intent', netRecoverable: money(200_00, 'GBP') };
  assert.equal(moreRecoverable(a, b), true);
  assert.equal(moreRecoverable(b, a), false);
});
