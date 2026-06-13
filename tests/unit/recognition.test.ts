import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RevRecError, straightLine, recognizeObligation, recognizeAll,
  recognizedInPeriod, cumulativeRecognized, deferredWaterfall, recognitionVariance,
  type PerformanceObligation,
} from '../../src/revrec/recognition.ts';
import { money } from '../../src/money/money.ts';

test('straightLine splits evenly and distributes remainder to earliest periods', () => {
  const slices = straightLine(money(1000, 'GBP'), 3); // 1000/3 = 333 r1
  assert.deepEqual(slices.map((s) => s.amount), [334, 333, 333]);
  assert.equal(slices.reduce((s, m) => s + m.amount, 0), 1000);
});

test('straightLine handles negative amounts (sign preserved, exact sum)', () => {
  const slices = straightLine(money(-1000, 'GBP'), 3);
  assert.equal(slices.reduce((s, m) => s + m.amount, 0), -1000);
});

test('straightLine rejects periods < 1', () => {
  assert.throws(() => straightLine(money(100, 'GBP'), 0), RevRecError);
});

test('recognizeObligation ratable produces a per-period schedule', () => {
  const po: PerformanceObligation = { id: 'po1', amount: money(1200, 'GBP'), method: 'ratable', startPeriod: 0, periods: 12 };
  const entries = recognizeObligation(po);
  assert.equal(entries.length, 12);
  assert.equal(entries.reduce((s, e) => s + e.recognized.amount, 0), 1200);
  assert.equal(entries[0]!.period, 0);
});

test('recognizeObligation point_in_time recognizes all at the offset period', () => {
  const po: PerformanceObligation = { id: 'po2', amount: money(500, 'GBP'), method: 'point_in_time', startPeriod: 2, periods: 6, pointPeriodOffset: 3 };
  const entries = recognizeObligation(po);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.period, 5); // start 2 + offset 3
  assert.equal(entries[0]!.recognized.amount, 500);
});

test('recognizeObligation point_in_time defaults offset to 0', () => {
  const po: PerformanceObligation = { id: 'po3', amount: money(500, 'GBP'), method: 'point_in_time', startPeriod: 1, periods: 4 };
  assert.equal(recognizeObligation(po)[0]!.period, 1);
});

test('recognizeObligation validates periods and offset bounds', () => {
  assert.throws(() => recognizeObligation({ id: 'x', amount: money(1, 'GBP'), method: 'ratable', startPeriod: 0, periods: 0 }), RevRecError);
  assert.throws(() => recognizeObligation({ id: 'x', amount: money(1, 'GBP'), method: 'point_in_time', startPeriod: 0, periods: 3, pointPeriodOffset: 3 }), RevRecError);
  assert.throws(() => recognizeObligation({ id: 'x', amount: money(1, 'GBP'), method: 'point_in_time', startPeriod: 0, periods: 3, pointPeriodOffset: -1 }), RevRecError);
});

test('recognizeAll combines multiple obligations', () => {
  const schedule = recognizeAll([
    { id: 'a', amount: money(1200, 'GBP'), method: 'ratable', startPeriod: 0, periods: 12 },
    { id: 'b', amount: money(500, 'GBP'), method: 'point_in_time', startPeriod: 0, periods: 1 },
  ]);
  assert.equal(schedule.length, 13);
});

test('recognizedInPeriod and cumulativeRecognized', () => {
  const schedule = recognizeObligation({ id: 'a', amount: money(1200, 'GBP'), method: 'ratable', startPeriod: 0, periods: 12 });
  assert.equal(recognizedInPeriod(schedule, 0, 'GBP').amount, 100);
  assert.equal(cumulativeRecognized(schedule, 2, 'GBP').amount, 300);
});

test('deferredWaterfall draws down the deferred balance to zero', () => {
  const schedule = recognizeObligation({ id: 'a', amount: money(1200, 'GBP'), method: 'ratable', startPeriod: 0, periods: 12 });
  const rows = deferredWaterfall(schedule, money(1200, 'GBP'), 11);
  assert.equal(rows.length, 12);
  assert.equal(rows[0]!.deferredRemaining.amount, 1100);
  assert.equal(rows[11]!.deferredRemaining.amount, 0);
});

test('deferredWaterfall rejects negative maxPeriod', () => {
  assert.throws(() => deferredWaterfall([], money(100, 'GBP'), -1), RevRecError);
});

test('recognitionVariance surfaces under-booked revenue, floors at zero', () => {
  const schedule = recognizeObligation({ id: 'a', amount: money(1200, 'GBP'), method: 'ratable', startPeriod: 0, periods: 12 });
  // through period 2 expected 300; actual 200 -> variance 100
  assert.equal(recognitionVariance(schedule, 2, money(200, 'GBP')).amount, 100);
  assert.equal(recognitionVariance(schedule, 2, money(300, 'GBP')).amount, 0);
  assert.equal(recognitionVariance(schedule, 2, money(400, 'GBP')).amount, 0); // over-booked
});
