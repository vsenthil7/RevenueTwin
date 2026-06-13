import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AnomalyError, computeStats, detectAnomalies, detectPeriodDrops, moneySeries,
  type Observation,
} from '../../src/anomaly/detection.ts';
import { money } from '../../src/money/money.ts';

function series(values: number[]): Observation[] {
  return values.map((v, i) => ({ id: `o${i}`, period: `2026-${String(i + 1).padStart(2, '0')}`, value: v }));
}

test('computeStats over odd-length series', () => {
  const s = computeStats([1, 2, 3]);
  assert.equal(s.n, 3);
  assert.equal(s.mean, 2);
  assert.equal(s.median, 2);
});

test('computeStats over even-length series (median/mad average two middles)', () => {
  const s = computeStats([1, 2, 3, 4]);
  assert.equal(s.median, 2.5);
  assert.equal(s.n, 4);
});

test('computeStats throws on empty', () => {
  assert.throws(() => computeStats([]), AnomalyError);
});

test('detectAnomalies returns empty for short series', () => {
  assert.deepEqual(detectAnomalies(series([1, 2])), []);
});

test('detectAnomalies rejects non-positive threshold', () => {
  assert.throws(() => detectAnomalies(series([1, 2, 3, 4]), 'mad', 0), AnomalyError);
});

test('detectAnomalies (mad) flags an outlier high', () => {
  const found = detectAnomalies(series([10, 12, 11, 9, 10, 13, 8, 200]), 'mad', 3);
  assert.ok(found.length >= 1);
  assert.equal(found[0]!.direction, 'high');
  assert.equal(found[0]!.method, 'mad');
  assert.ok(found[0]!.confidence > 0);
});

test('detectAnomalies (mad) flags an outlier low', () => {
  const found = detectAnomalies(series([100, 102, 98, 101, 99, 103, 97, 5]), 'mad', 3);
  assert.equal(found[0]!.direction, 'low');
});

test('detectAnomalies (mad) returns empty when MAD is zero', () => {
  assert.deepEqual(detectAnomalies(series([5, 5, 5, 5]), 'mad', 3), []);
});

test('detectAnomalies (zscore) flags an outlier and skips zero-variance', () => {
  // Many tight values + one clear outlier so the z-score exceeds threshold.
  const found = detectAnomalies(series([10, 10, 10, 10, 10, 10, 10, 10, 10, 30]), 'zscore', 2);
  assert.ok(found.length >= 1);
  assert.equal(found[0]!.method, 'zscore');
  assert.equal(found[0]!.direction, 'high');
  assert.ok(found[0]!.confidence >= 0);
  assert.deepEqual(detectAnomalies(series([7, 7, 7, 7]), 'zscore', 2), []);
});

test('detectAnomalies (zscore) flags a low outlier', () => {
  const found = detectAnomalies(series([100, 100, 100, 100, 100, 100, 100, 100, 100, 20]), 'zscore', 2);
  assert.ok(found.length >= 1);
  assert.equal(found[0]!.direction, 'low');
});

test('detectPeriodDrops flags cliffs and skips non-positive base', () => {
  const drops = detectPeriodDrops(series([100, 40, 40, 0, 50]), 50);
  // 100->40 = 60% (flag); 40->40 = 0% (no); 40->0 = 100% (flag); 0->50 base<=0 (skip)
  assert.equal(drops.length, 2);
  assert.equal(drops[0]!.dropPct, 60);
  assert.equal(drops[1]!.dropPct, 100);
});

test('detectPeriodDrops validates dropPct range', () => {
  assert.throws(() => detectPeriodDrops(series([1, 2]), 0), AnomalyError);
  assert.throws(() => detectPeriodDrops(series([1, 2]), 100), AnomalyError);
});

test('moneySeries converts Money to major-unit observations', () => {
  const obs = moneySeries([{ id: 'a', period: '2026-01', amount: money(1250, 'GBP') }]);
  assert.equal(obs[0]!.value, 12.5);
});
