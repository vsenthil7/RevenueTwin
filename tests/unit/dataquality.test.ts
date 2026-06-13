import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DataQualityError, scoreQuality, gateByQuality,
  type QualityInput, type FieldSpec,
} from '../../src/dataquality/scoring.ts';

const fields: FieldSpec[] = [
  { name: 'id', required: true },
  { name: 'amount', required: true },
  { name: 'note', required: false },
];

function input(over: Partial<QualityInput> = {}): QualityInput {
  return {
    sourceId: 'sf',
    records: [{ id: 'a', amount: 1 }, { id: 'b', amount: 2 }],
    requiredFields: fields,
    lastSyncAt: '2026-01-01T00:00:00Z',
    now: '2026-01-01T01:00:00Z',
    freshnessSlaHours: 24,
    ...over,
  };
}

test('scoreQuality: complete, fresh, consistent data grades A', () => {
  const s = scoreQuality(input());
  assert.equal(s.completeness, 1);
  assert.equal(s.freshness, 1);
  assert.equal(s.consistency, 1);
  assert.equal(s.overall, 1);
  assert.equal(s.grade, 'A');
  assert.equal(s.recordCount, 2);
});

test('completeness reflects missing required fields', () => {
  const s = scoreQuality(input({ records: [{ id: 'a' }, { id: 'b', amount: 2 }] }));
  // record1 has 1/2 required, record2 2/2 -> (0.5 + 1)/2 = 0.75
  assert.equal(s.completeness, 0.75);
});

test('completeness is 1 when no required fields, 0 when no records', () => {
  assert.equal(scoreQuality(input({ requiredFields: [{ name: 'note', required: false }] })).completeness, 1);
  assert.equal(scoreQuality(input({ records: [] })).completeness, 0);
});

test('freshness decays after SLA and is 0 past 2x SLA', () => {
  const within = scoreQuality(input({ now: '2026-01-01T12:00:00Z' })); // 12h < 24h SLA
  assert.equal(within.freshness, 1);
  const decaying = scoreQuality(input({ now: '2026-01-02T12:00:00Z' })); // 36h -> 1 - (36-24)/24 = 0.5
  assert.equal(decaying.freshness, 0.5);
  const stale = scoreQuality(input({ now: '2026-01-03T00:00:00Z' })); // 48h -> 0
  assert.equal(stale.freshness, 0);
});

test('freshness rejects bad SLA and bad timestamps', () => {
  assert.throws(() => scoreQuality(input({ freshnessSlaHours: 0 })), DataQualityError);
  assert.throws(() => scoreQuality(input({ lastSyncAt: 'not-a-date' })), DataQualityError);
});

test('consistency penalizes NaN-numeric required fields; zero records -> 0', () => {
  const s = scoreQuality(input({ records: [{ id: 'a', amount: Number.NaN }, { id: 'b', amount: 2 }] }));
  assert.equal(s.consistency, 0.5);
  assert.equal(scoreQuality(input({ records: [] })).consistency, 0);
});

test('grade boundaries map correctly', () => {
  // Build inputs to land each grade by varying freshness only (completeness+consistency=1).
  // overall = 0.8 + 0.2*freshness
  const grade = (freshness: number) => scoreQuality(input({
    now: freshnessToNow(freshness),
  })).grade;
  function freshnessToNow(f: number): string {
    // freshness 1 -> within SLA; 0.5 -> 36h; 0 -> 48h+
    const hours = f >= 1 ? 1 : f <= 0 ? 48 : 24 + (1 - f) * 24;
    return new Date(Date.parse('2026-01-01T00:00:00Z') + hours * 3_600_000).toISOString();
  }
  assert.equal(grade(1), 'A');   // overall 1.0
  assert.equal(grade(0.5), 'A'); // overall 0.9
  assert.equal(grade(0), 'B');   // overall 0.8
});

test('grade C/D/F via lower completeness', () => {
  // Grade C: overall in [0.7, 0.8). completeness 0.5, consistency 1, freshness 0.5
  //   = 0.4*0.5 + 0.4*1 + 0.2*0.5 = 0.2+0.4+0.1 = 0.7 -> C
  const c = scoreQuality(input({ records: [{ id: 'a' }, { id: 'b' }], now: '2026-01-02T12:00:00Z' }));
  assert.equal(c.grade, 'C');
  // Grade D: overall in [0.6,0.7). completeness 0.5, consistency 1, freshness 0
  //   = 0.2 + 0.4 + 0 = 0.6 -> D
  const d = scoreQuality(input({ records: [{ id: 'a' }, { id: 'b' }], now: '2026-01-03T00:00:00Z' }));
  assert.equal(d.grade, 'D');
  // Grade F: completeness 0, consistency 1, freshness 0 -> 0.4
  const f = scoreQuality(input({ records: [{ foo: 1 }], now: '2026-01-05T00:00:00Z' }));
  assert.equal(f.grade, 'F');
});

test('gateByQuality multiplies confidence by quality and holds below gate', () => {
  const q = scoreQuality(input());
  const pass = gateByQuality(0.9, q, 0.5);
  assert.equal(pass.held, false);
  const lowQ = scoreQuality(input({ records: [{ foo: 1 }], now: '2026-01-05T00:00:00Z' })); // overall low
  const held = gateByQuality(0.9, lowQ, 0.5);
  assert.equal(held.held, true);
});

test('gateByQuality validates confidence range', () => {
  const q = scoreQuality(input());
  assert.throws(() => gateByQuality(1.5, q), DataQualityError);
  assert.throws(() => gateByQuality(-0.1, q), DataQualityError);
});
