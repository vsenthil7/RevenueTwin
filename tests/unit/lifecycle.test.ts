import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LifecycleError, buildRamp, rampTotalValue, rampValueAtMonth, coTerm, applyMidTermChange, monthsToRenewal,
} from '../../src/contracts/lifecycle.ts';
import { money } from '../../src/money/money.ts';

test('buildRamp escalates per period after the first', () => {
  const ramp = buildRamp(money(10000_00, 'GBP'), [12, 12, 12], 20);
  assert.equal(ramp[0]!.monthlyValue.amount, 10000_00);
  assert.equal(ramp[1]!.monthlyValue.amount, 12000_00); // +20%
  assert.equal(ramp[2]!.monthlyValue.amount, 14400_00); // +20% again
});

test('buildRamp validates periods', () => {
  assert.throws(() => buildRamp(money(100, 'GBP'), [], 10), LifecycleError);
  assert.throws(() => buildRamp(money(100, 'GBP'), [0], 10), LifecycleError);
});

test('rampTotalValue sums monthly value × months', () => {
  const ramp = buildRamp(money(10000_00, 'GBP'), [12, 12], 20);
  // 10000*12 + 12000*12 = (120000 + 144000) *100
  assert.equal(rampTotalValue(ramp).amount, (10000_00 * 12) + (12000_00 * 12));
});

test('rampTotalValue rejects an empty ramp', () => {
  assert.throws(() => rampTotalValue([]), LifecycleError);
});

test('rampValueAtMonth returns the right tier; out-of-range throws', () => {
  const ramp = buildRamp(money(10000_00, 'GBP'), [12, 12], 20);
  assert.equal(rampValueAtMonth(ramp, 0).amount, 10000_00);
  assert.equal(rampValueAtMonth(ramp, 11).amount, 10000_00);
  assert.equal(rampValueAtMonth(ramp, 12).amount, 12000_00);
  assert.throws(() => rampValueAtMonth(ramp, -1), LifecycleError);
  assert.throws(() => rampValueAtMonth(ramp, 99), LifecycleError);
});

test('coTerm prorates extension and shortening', () => {
  const results = coTerm([
    { contractId: 'a', monthlyValue: money(3000_00, 'GBP'), currentEndDate: '2026-06-01' },
    { contractId: 'b', monthlyValue: money(3000_00, 'GBP'), currentEndDate: '2026-08-01' },
  ], '2026-07-01');
  const a = results.find((r) => r.contractId === 'a')!;
  assert.equal(a.alignedEndDate, '2026-07-01');
  assert.ok(a.extraDays > 0); // extended
  assert.ok(a.proratedAdjustment.amount > 0);
  const b = results.find((r) => r.contractId === 'b')!;
  assert.ok(b.extraDays < 0); // shortened
  assert.ok(b.proratedAdjustment.amount < 0);
});

test('applyMidTermChange splits a period into prorated sub-periods', () => {
  const parts = applyMidTermChange('2026-01-01', '2026-01-31', money(3000_00, 'GBP'), {
    effectiveDate: '2026-01-16', newMonthlyValue: money(6000_00, 'GBP'),
  });
  assert.equal(parts.length, 2);
  assert.equal(parts[0]!.from, '2026-01-01');
  assert.equal(parts[1]!.to, '2026-01-31');
  assert.ok(parts[1]!.value.amount > parts[0]!.value.amount); // higher new rate
});

test('applyMidTermChange validates the period and change date', () => {
  assert.throws(() => applyMidTermChange('2026-01-31', '2026-01-01', money(100, 'GBP'), { effectiveDate: '2026-01-15', newMonthlyValue: money(100, 'GBP') }), LifecycleError);
  // change before/at start
  assert.throws(() => applyMidTermChange('2026-01-01', '2026-01-31', money(100, 'GBP'), { effectiveDate: '2026-01-01', newMonthlyValue: money(100, 'GBP') }), LifecycleError);
  // change at/after end
  assert.throws(() => applyMidTermChange('2026-01-01', '2026-01-31', money(100, 'GBP'), { effectiveDate: '2026-02-15', newMonthlyValue: money(100, 'GBP') }), LifecycleError);
});

test('daysBetween rejects invalid dates (via coTerm)', () => {
  assert.throws(() => coTerm([{ contractId: 'a', monthlyValue: money(100, 'GBP'), currentEndDate: 'bad' }], '2026-01-01'), LifecycleError);
});

test('monthsToRenewal floors and never goes negative', () => {
  assert.equal(monthsToRenewal('2026-01-01', '2026-04-01'), 3);
  assert.equal(monthsToRenewal('2026-04-01', '2026-01-01'), 0); // past
});
