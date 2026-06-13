import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DetectorError, evaluateCondition, runDetector, runDetectorSuite, totalFlagged, validateRule,
  type Condition, type DetectorRule, type RecordShape,
} from '../../src/detectors/dsl.ts';

const record: RecordShape = { amount: 1000, status: 'unbilled', flagged: true };

test('evaluateCondition compare: eq/ne and numeric ops', () => {
  assert.equal(evaluateCondition({ kind: 'compare', field: 'status', op: 'eq', value: 'unbilled' }, record), true);
  assert.equal(evaluateCondition({ kind: 'compare', field: 'status', op: 'ne', value: 'billed' }, record), true);
  assert.equal(evaluateCondition({ kind: 'compare', field: 'amount', op: 'gt', value: 500 }, record), true);
  assert.equal(evaluateCondition({ kind: 'compare', field: 'amount', op: 'gte', value: 1000 }, record), true);
  assert.equal(evaluateCondition({ kind: 'compare', field: 'amount', op: 'lt', value: 2000 }, record), true);
  assert.equal(evaluateCondition({ kind: 'compare', field: 'amount', op: 'lte', value: 1000 }, record), true);
});

test('evaluateCondition numeric ops on non-numbers throw', () => {
  assert.throws(() => evaluateCondition({ kind: 'compare', field: 'status', op: 'gt', value: 'x' }, record), DetectorError);
});

test('evaluateCondition unknown field throws', () => {
  assert.throws(() => evaluateCondition({ kind: 'compare', field: 'missing', op: 'eq', value: 1 }, record), DetectorError);
});

test('evaluateCondition and/or/not compose', () => {
  const and: Condition = { kind: 'and', clauses: [
    { kind: 'compare', field: 'amount', op: 'gt', value: 500 },
    { kind: 'compare', field: 'status', op: 'eq', value: 'unbilled' },
  ] };
  assert.equal(evaluateCondition(and, record), true);
  const or: Condition = { kind: 'or', clauses: [
    { kind: 'compare', field: 'amount', op: 'lt', value: 0 },
    { kind: 'compare', field: 'flagged', op: 'eq', value: true },
  ] };
  assert.equal(evaluateCondition(or, record), true);
  const not: Condition = { kind: 'not', clause: { kind: 'compare', field: 'status', op: 'eq', value: 'billed' } };
  assert.equal(evaluateCondition(not, record), true);
});

const rule: DetectorRule = {
  id: 'unbilled-large',
  description: 'Large unbilled amounts',
  when: { kind: 'and', clauses: [
    { kind: 'compare', field: 'amount', op: 'gt', value: 500 },
    { kind: 'compare', field: 'status', op: 'eq', value: 'unbilled' },
  ] },
  amountField: 'amount',
};

test('runDetector returns hits with the recoverable amount', () => {
  const records: RecordShape[] = [
    { amount: 1000, status: 'unbilled' },
    { amount: 200, status: 'unbilled' },  // below threshold
    { amount: 800, status: 'billed' },     // wrong status
  ];
  const hits = runDetector(rule, records);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.amountMinor, 1000);
  assert.equal(hits[0]!.recordIndex, 0);
});

test('runDetector throws when amountField is missing/non-integer on a match', () => {
  const records: RecordShape[] = [{ amount: 'lots' as unknown as number, status: 'unbilled' }];
  // condition compares amount gt 500 -> 'lots' is not a number -> compare throws first
  assert.throws(() => runDetector(rule, records), DetectorError);
  // a matching record whose amountField is non-integer
  const r2: DetectorRule = { ...rule, when: { kind: 'compare', field: 'status', op: 'eq', value: 'unbilled' }, amountField: 'note' };
  assert.throws(() => runDetector(r2, [{ status: 'unbilled', note: 'x' }]), DetectorError);
});

test('runDetectorSuite runs many rules and rejects duplicate ids', () => {
  const records: RecordShape[] = [{ amount: 1000, status: 'unbilled' }];
  const hits = runDetectorSuite([rule, { ...rule, id: 'other' }], records);
  assert.equal(hits.length, 2);
  assert.throws(() => runDetectorSuite([rule, { ...rule }], records), DetectorError);
});

test('totalFlagged sums hit amounts', () => {
  const hits = runDetector(rule, [{ amount: 1000, status: 'unbilled' }, { amount: 700, status: 'unbilled' }]);
  assert.equal(totalFlagged(hits), 1700);
});

test('validateRule checks amountField and all referenced fields against schema', () => {
  const known = ['amount', 'status', 'flagged'];
  assert.doesNotThrow(() => validateRule(rule, known));
  assert.throws(() => validateRule({ ...rule, amountField: 'ghost' }, known), DetectorError);
  // unknown field inside a compare
  const badField: DetectorRule = { ...rule, when: { kind: 'compare', field: 'ghost', op: 'eq', value: 1 } };
  assert.throws(() => validateRule(badField, known), DetectorError);
  // empty and/or clauses
  const emptyAnd: DetectorRule = { ...rule, when: { kind: 'and', clauses: [] } };
  assert.throws(() => validateRule(emptyAnd, known), DetectorError);
  // not wrapping is walked
  const notRule: DetectorRule = { ...rule, when: { kind: 'not', clause: { kind: 'compare', field: 'status', op: 'eq', value: 'x' } } };
  assert.doesNotThrow(() => validateRule(notRule, known));
});
