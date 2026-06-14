import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffScans } from '../../src/scheduler/rescan.ts';

function mkCase(id: string, customerId: string, net: number) {
  return { id, customerId, status: 'open' as const, createdAt: '2026-01-01T00:00:00.000Z',
    findings: [{ id: id + '-f', type: 'price_changed' as const, netRecoverable: { amount: net, currency: 'GBP' as const } }] };
}

test('diffScans: a brand-new case is reported as new leakage', () => {
  const r = diffScans([], [mkCase('c1', 'acme', 5000)]);
  assert.equal(r.deltas.length, 1);
  assert.equal(r.deltas[0]!.kind, 'new');
  assert.equal(r.newLeakageMinor, 5000);
  assert.equal(r.resolvedLeakageMinor, 0);
  assert.equal(r.netChangeMinor, 5000);
  assert.equal(r.hasChanges, true);
});

test('diffScans: a case gone from current is resolved', () => {
  const r = diffScans([mkCase('c1', 'acme', 5000)], []);
  assert.equal(r.deltas[0]!.kind, 'resolved');
  assert.equal(r.resolvedLeakageMinor, 5000);
  assert.equal(r.netChangeMinor, -5000);
});

test('diffScans: a case whose net grew is reported as grown', () => {
  const r = diffScans([mkCase('c1', 'acme', 5000)], [mkCase('c1', 'acme', 8000)]);
  assert.equal(r.deltas[0]!.kind, 'grown');
  assert.equal(r.deltas[0]!.deltaMinor, 3000);
  assert.equal(r.newLeakageMinor, 3000);
});

test('diffScans: a case whose net shrank is reported as shrunk', () => {
  const r = diffScans([mkCase('c1', 'acme', 8000)], [mkCase('c1', 'acme', 5000)]);
  assert.equal(r.deltas[0]!.kind, 'shrunk');
  assert.equal(r.deltas[0]!.deltaMinor, -3000);
  assert.equal(r.resolvedLeakageMinor, 3000);
});

test('diffScans: an unchanged case produces no delta', () => {
  const r = diffScans([mkCase('c1', 'acme', 5000)], [mkCase('c1', 'acme', 5000)]);
  assert.equal(r.deltas.length, 0);
  assert.equal(r.hasChanges, false);
});

test('diffScans: mixed scan - new, grown, resolved together', () => {
  const baseline = [mkCase('c1', 'acme', 5000), mkCase('c2', 'globex', 2000)];
  const current = [mkCase('c1', 'acme', 9000), mkCase('c3', 'initech', 1000)];
  const r = diffScans(baseline, current);
  // c1 grown +4000, c3 new +1000, c2 resolved -2000
  assert.equal(r.deltas.length, 3);
  assert.equal(r.newLeakageMinor, 5000);
  assert.equal(r.resolvedLeakageMinor, 2000);
  assert.equal(r.netChangeMinor, 3000);
});
