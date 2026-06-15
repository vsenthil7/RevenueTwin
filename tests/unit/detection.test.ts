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

test('score: f1 is the exact harmonic mean for asymmetric precision/recall', () => {
  // planted a,b,c ; detected a,b,x -> tp2 fp1 fn1 -> precision 2/3, recall 2/3
  // pick an asymmetric case instead: planted a,b,c,d ; detected a,b,x -> p=2/3, r=2/4=0.5
  const s = score(['a','b','c','d'], ['a','b','x']);
  assert.equal(Math.round(s.precision*1000)/1000, 0.667);
  assert.equal(s.recall, 0.5);
  // f1 = 2*p*r/(p+r) = 2*(2/3)*(1/2)/((2/3)+(1/2)) = (2/3)/(7/6) = 0.5714...
  assert.equal(Math.round(s.f1*10000)/10000, 0.5714);
});

test('assertNoRegression: exactly at the tolerance boundary does NOT throw (strict <)', () => {
  // baseline recall 1.0; current recall 0.99 with tolerance 0.01 -> 0.99 < 1.0-0.01=0.99 is false -> ok
  const baseline = { truePositives: 100, falsePositives: 0, falseNegatives: 0, precision: 1, recall: 1, f1: 1 };
  const current = { truePositives: 99, falsePositives: 0, falseNegatives: 1, precision: 1, recall: 0.99, f1: 0.995 };
  assert.doesNotThrow(() => assertNoRegression(baseline, current, 0.01));
});

test('assertNoRegression: precision exactly at boundary does NOT throw', () => {
  const baseline = { truePositives: 100, falsePositives: 0, falseNegatives: 0, precision: 1, recall: 1, f1: 1 };
  const current = { truePositives: 100, falsePositives: 1, falseNegatives: 0, precision: 0.99, recall: 1, f1: 0.995 };
  assert.doesNotThrow(() => assertNoRegression(baseline, current, 0.01));
});
