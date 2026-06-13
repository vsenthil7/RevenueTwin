import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MetricsError, percentile, latencyMetrics, slaAttainment, queueDepth, recoveryVelocity,
  type CaseLifecycleEvent,
} from '../../src/observability/metrics.ts';

function ev(over: Partial<CaseLifecycleEvent> = {}): CaseLifecycleEvent {
  return {
    caseId: 'c1',
    leakOccurredAt: '2026-01-01T00:00:00Z',
    detectedAt: '2026-01-01T10:00:00Z',
    resolvedAt: '2026-01-02T10:00:00Z',
    slaDueAt: '2026-01-03T00:00:00Z',
    ...over,
  };
}

test('percentile: empty throws, out-of-range p throws', () => {
  assert.throws(() => percentile([], 50), MetricsError);
  assert.throws(() => percentile([1, 2], -1), MetricsError);
  assert.throws(() => percentile([1, 2], 101), MetricsError);
});

test('percentile: single value, exact rank, interpolation', () => {
  assert.equal(percentile([5], 90), 5);
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3); // exact integer rank
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5);  // interpolated
  assert.equal(percentile([10, 20], 0), 10);
});

test('latencyMetrics computes detection latency + MTTR with open/resolved counts', () => {
  const m = latencyMetrics([
    ev(), // detection 10h, mttr 24h, resolved
    ev({ caseId: 'c2', detectedAt: '2026-01-01T20:00:00Z', resolvedAt: null }), // detection 20h, open
  ]);
  assert.equal(m.detectionLatencyHoursAvg, 15); // (10 + 20)/2
  assert.equal(m.mttrHoursAvg, 24);
  assert.equal(m.resolvedCount, 1);
  assert.equal(m.openCount, 1);
  assert.ok(m.detectionLatencyP90 > 0);
});

test('latencyMetrics handles all-open (no MTTR sample) without dividing by zero', () => {
  const m = latencyMetrics([ev({ resolvedAt: null })]);
  assert.equal(m.mttrHoursAvg, 0);
  assert.equal(m.mttrP90, 0);
  assert.equal(m.resolvedCount, 0);
});

test('latencyMetrics over an empty event list yields zeros', () => {
  const m = latencyMetrics([]);
  assert.equal(m.detectionLatencyHoursAvg, 0);
  assert.equal(m.detectionLatencyP90, 0);
  assert.equal(m.mttrHoursAvg, 0);
  assert.equal(m.mttrP90, 0);
  assert.equal(m.resolvedCount, 0);
  assert.equal(m.openCount, 0);
});

test('latencyMetrics rejects an invalid timestamp', () => {
  assert.throws(() => latencyMetrics([ev({ detectedAt: 'bad' })]), MetricsError);
});

test('slaAttainment: rate over cases with a due date; skips null SLA', () => {
  const r = slaAttainment([
    ev(), // resolved 01-02 <= due 01-03 -> attained
    ev({ caseId: 'c2', resolvedAt: '2026-01-04T00:00:00Z' }), // past due -> missed
    ev({ caseId: 'c3', slaDueAt: null }), // skipped
    ev({ caseId: 'c4', resolvedAt: null }), // unresolved -> not attained
  ]);
  assert.equal(r.total, 3);
  assert.equal(r.attained, 1);
  assert.equal(r.rate, Math.round((1 / 3) * 10000) / 10000);
});

test('slaAttainment with no SLA-bearing cases yields rate 0', () => {
  assert.equal(slaAttainment([ev({ slaDueAt: null })]).rate, 0);
});

test('queueDepth counts detected-but-unresolved as-of a time; rejects bad asOf', () => {
  const events = [
    ev(), // detected 01-01 10:00, resolved 01-02 10:00
    ev({ caseId: 'c2', resolvedAt: null }), // detected, never resolved
    ev({ caseId: 'c3', detectedAt: '2026-02-01T00:00:00Z', resolvedAt: null }), // detected later
  ];
  // as-of 01-01 12:00: c1 detected+open, c2 detected+open, c3 not yet detected -> depth 2
  assert.equal(queueDepth(events, '2026-01-01T12:00:00Z'), 2);
  // as-of 01-03: c1 resolved, c2 open, c3 not detected -> depth 1
  assert.equal(queueDepth(events, '2026-01-03T00:00:00Z'), 1);
  assert.throws(() => queueDepth(events, 'bad'), MetricsError);
});

test('recoveryVelocity: resolved per day; rejects non-positive window', () => {
  const events = [ev(), ev({ caseId: 'c2' }), ev({ caseId: 'c3', resolvedAt: null })];
  assert.equal(recoveryVelocity(events, 2), 1); // 2 resolved / 2 days
  assert.throws(() => recoveryVelocity(events, 0), MetricsError);
});
