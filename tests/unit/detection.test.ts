import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score, assertNoRegression, MetricsError } from '../../src/metrics/detection.ts';

test('score: perfect detection -> precision/recall/f1 = 1', () => {
  const s = score(['a', 'b'], ['a', 'b']);
  assert.equal(s.precision, 1); assert.equal(s.recall, 1); assert.equal(s.f1, 1);
  assert.equal(s.truePositives, 2);
});

test('score: a false positive lowers precision', () => {
  const s = score(['a'], ['a', 'x']);
  assert.equal(s.truePositives, 1); assert.equal(s.falsePositives, 1);
  assert.equal(s.precision, 0.5); assert.equal(s.recall, 1);
});

test('score: a missed defect lowers recall', () => {
  const s = score(['a', 'b'], ['a']);
  assert.equal(s.falseNegatives, 1); assert.equal(s.recall, 0.5); assert.equal(s.precision, 1);
});

test('score: empty planted + empty detected -> perfect (vacuous)', () => {
  const s = score([], []);
  assert.equal(s.precision, 1); assert.equal(s.recall, 1); assert.equal(s.f1, 1);
});

test('score: empty planted but a detection -> precision 0', () => {
  const s = score([], ['x']);
  assert.equal(s.precision, 0);
});

test('score: detections empty but defects planted -> recall 0, precision 0', () => {
  const s = score(['a'], []);
  assert.equal(s.recall, 0); assert.equal(s.precision, 0); assert.equal(s.f1, 0);
});

test('assertNoRegression: equal scores pass', () => {
  const b = score(['a'], ['a']);
  assert.doesNotThrow(() => assertNoRegression(b, b));
});

test('assertNoRegression: recall drop fails the gate', () => {
  const base = score(['a', 'b'], ['a', 'b']);
  const worse = score(['a', 'b'], ['a']);
  assert.throws(() => assertNoRegression(base, worse), MetricsError);
});

test('assertNoRegression: precision drop fails the gate', () => {
  const base = score(['a'], ['a']);
  const worse = score(['a'], ['a', 'x', 'y']);
  assert.throws(() => assertNoRegression(base, worse), MetricsError);
});
