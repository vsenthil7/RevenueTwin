import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ReportError, caseNet, portfolioSummary, leakageByType, recoveredOverTime, periodClosePack,
} from '../../src/reporting/analytics.ts';
import { money } from '../../src/money/money.ts';
import type { LeakageCase, CaseStatus, LeakageType } from '../../src/core/model.ts';

function caseOf(
  id: string, status: CaseStatus, net: number,
  opts: { workIQ?: boolean; createdAt?: string; type?: LeakageType } = {},
): LeakageCase {
  return {
    id, customerId: 'acme', status, createdAt: opts.createdAt ?? '2026-01-15',
    findings: [{ id: `${id}-f`, type: opts.type ?? 'intent', netRecoverable: money(net, 'GBP') }],
    ...(opts.workIQ !== undefined ? { detectedViaWorkIQ: opts.workIQ } : {}),
  };
}

test('caseNet sums findings', () => {
  const c: LeakageCase = {
    id: 'c', customerId: 'x', status: 'open', createdAt: '2026-01-01',
    findings: [
      { id: 'a', type: 'intent', netRecoverable: money(300_00, 'GBP') },
      { id: 'b', type: 'tax', netRecoverable: money(200_00, 'GBP') },
    ],
  };
  assert.equal(caseNet(c, 'GBP').amount, 500_00);
});

test('portfolioSummary totals, recovered, rate, and Work IQ attribution', () => {
  const cases = [
    caseOf('a', 'recovered', 300_00, { workIQ: true }),
    caseOf('b', 'partially_recovered', 100_00),
    caseOf('c', 'open', 600_00, { workIQ: true }),
  ];
  const s = portfolioSummary(cases, 'GBP');
  assert.equal(s.totalCases, 3);
  assert.equal(s.totalRecoverable.amount, 1000_00);
  assert.equal(s.recoveredToDate.amount, 400_00); // recovered + partially_recovered
  assert.equal(s.recoveryRatePct, 40);
  assert.equal(s.workIQAttributable.amount, 900_00); // a + c
});

test('portfolioSummary rate is zero when nothing recoverable', () => {
  const s = portfolioSummary([], 'GBP');
  assert.equal(s.recoveryRatePct, 0);
  assert.equal(s.totalRecoverable.amount, 0);
});

test('leakageByType aggregates and ranks by recoverable desc', () => {
  const cases = [
    caseOf('a', 'open', 100_00, { type: 'intent' }),
    caseOf('b', 'open', 500_00, { type: 'tax' }),
    caseOf('c', 'open', 200_00, { type: 'intent' }),
  ];
  const byType = leakageByType(cases, 'GBP');
  assert.equal(byType[0]!.type, 'tax'); // 500 highest
  assert.equal(byType[0]!.recoverable.amount, 500_00);
  const intent = byType.find((b) => b.type === 'intent')!;
  assert.equal(intent.cases, 2);
  assert.equal(intent.recoverable.amount, 300_00);
});

test('recoveredOverTime buckets recovered cases by month, sorted', () => {
  const cases = [
    caseOf('a', 'recovered', 100_00, { createdAt: '2026-03-10' }),
    caseOf('b', 'recovered', 200_00, { createdAt: '2026-01-20' }),
    caseOf('c', 'open', 999_00, { createdAt: '2026-01-05' }), // not recovered -> excluded
  ];
  const timeline = recoveredOverTime(cases, 'GBP');
  assert.deepEqual(timeline.map((p) => p.period), ['2026-01', '2026-03']);
  assert.equal(timeline[0]!.recovered.amount, 200_00);
});

test('recoveredOverTime rejects a malformed createdAt', () => {
  const bad = caseOf('x', 'recovered', 100_00, { createdAt: 'bad' });
  assert.throws(() => recoveredOverTime([bad], 'GBP'), ReportError);
});

test('periodClosePack filters to range and assembles the pack', () => {
  const cases = [
    caseOf('in1', 'recovered', 300_00, { createdAt: '2026-02-10' }),
    caseOf('in2', 'open', 100_00, { createdAt: '2026-02-20' }),
    caseOf('out', 'recovered', 999_00, { createdAt: '2026-05-01' }), // out of range
  ];
  const pack = periodClosePack(cases, 'GBP', '2026-02-01', '2026-02-28');
  assert.deepEqual(pack.caseIds.sort(), ['in1', 'in2']);
  assert.equal(pack.summary.totalRecoverable.amount, 400_00);
  assert.equal(pack.timeline.length, 1);
  assert.ok(pack.byType.length >= 1);
});

test('periodClosePack validates bounds', () => {
  assert.throws(() => periodClosePack([], 'GBP', 'bad', '2026-01-01'), ReportError);
  assert.throws(() => periodClosePack([], 'GBP', '2026-03-01', '2026-01-01'), ReportError);
});
