import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConnectorError, CursorStore, SyncEngine,
  type RawRecord, type SourceConnector,
} from '../../src/connectors/ingestion.ts';
import { FixtureConnector } from '../../src/connectors/fixture-connector.ts';
import {
  normalize, normalizeBatch, normalizeMoney, reasonOf,
  toCustomer, toContract, toContractTerm, toInvoice, toInvoiceLine, toCommercialIntentEvent,
} from '../../src/connectors/normalize.ts';

function rec(kind: string, data: Record<string, unknown>, over: Partial<RawRecord> = {}): RawRecord {
  return { sourceId: 'sf', externalId: 'x1', kind, updatedAt: '2026-01-01T00:00:00Z', data, ...over };
}

/* ─────────────────────── CursorStore ─────────────────────── */

test('CursorStore returns a default cursor for unknown source', () => {
  const s = new CursorStore();
  const c = s.get('sf');
  assert.equal(c.cursor, null);
  assert.equal(c.recordsIngested, 0);
});

test('CursorStore set/get/all', () => {
  const s = new CursorStore();
  s.set({ sourceId: 'sf', cursor: '10', lastSyncAt: '2026-01-01', recordsIngested: 10 });
  assert.equal(s.get('sf').cursor, '10');
  assert.equal(s.all().length, 1);
});

/* ─────────────────────── FixtureConnector ─────────────────────── */

function fixtureRecords(n: number): RawRecord[] {
  return Array.from({ length: n }, (_, i) => rec('customer', { id: `c${i}` }, { externalId: `c${i}`, updatedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z` }));
}

test('FixtureConnector pulls pages and signals drain via null cursor', async () => {
  const fc = new FixtureConnector('sf', 'crm', fixtureRecords(5));
  const p1 = await fc.pull(null, 2);
  assert.equal(p1.records.length, 2);
  assert.equal(p1.nextCursor, '2');
  const p3 = await fc.pull('4', 2);
  assert.equal(p3.records.length, 1);
  assert.equal(p3.nextCursor, null); // drained
});

test('FixtureConnector rejects an invalid cursor', async () => {
  const fc = new FixtureConnector('sf', 'crm', fixtureRecords(2));
  await assert.rejects(() => fc.pull('-1', 2), /Invalid cursor/);
  await assert.rejects(() => fc.pull('abc', 2), /Invalid cursor/);
});

test('FixtureConnector health is settable', async () => {
  const fc = new FixtureConnector('sf', 'crm');
  assert.equal(await fc.health(), 'healthy');
  fc.setHealth('degraded');
  assert.equal(await fc.health(), 'degraded');
});

/* ─────────────────────── SyncEngine ─────────────────────── */

test('SyncEngine drains a healthy source, records cursor + count', async () => {
  const cursors = new CursorStore();
  const engine = new SyncEngine(cursors, () => '2026-06-01T00:00:00Z');
  const fc = new FixtureConnector('sf', 'crm', fixtureRecords(5));
  const seen: RawRecord[] = [];
  const result = await engine.sync(fc, async (r) => { seen.push(...r); }, { pageSize: 2 });
  assert.equal(result.status, 'completed');
  assert.equal(result.pulled, 5);
  assert.equal(result.cursor, null);
  assert.equal(seen.length, 5);
  assert.equal(cursors.get('sf').recordsIngested, 5);
  assert.equal(cursors.get('sf').lastSyncAt, '2026-06-01T00:00:00Z');
});

test('SyncEngine skips an unavailable source', async () => {
  const engine = new SyncEngine(new CursorStore());
  const fc = new FixtureConnector('sf', 'crm', fixtureRecords(3));
  fc.setHealth('unavailable');
  const result = await engine.sync(fc, async () => {});
  assert.equal(result.status, 'skipped');
  assert.equal(result.pulled, 0);
});

test('SyncEngine reports degraded status while still pulling', async () => {
  const engine = new SyncEngine(new CursorStore());
  const fc = new FixtureConnector('sf', 'crm', fixtureRecords(2));
  fc.setHealth('degraded');
  const result = await engine.sync(fc, async () => {}, { pageSize: 10 });
  assert.equal(result.status, 'degraded');
  assert.equal(result.pulled, 2);
});

test('SyncEngine honors maxPages cap (does not fully drain)', async () => {
  const engine = new SyncEngine(new CursorStore());
  const fc = new FixtureConnector('sf', 'crm', fixtureRecords(10));
  const result = await engine.sync(fc, async () => {}, { pageSize: 2, maxPages: 2 });
  assert.equal(result.pages, 2);
  assert.equal(result.pulled, 4);
  assert.notEqual(result.cursor, null); // not drained
});

test('SyncEngine handles an empty page without invoking onRecords', async () => {
  const empty: SourceConnector = {
    id: 'empty', category: 'crm',
    async health() { return 'healthy'; },
    async pull() { return { records: [], nextCursor: null }; },
  };
  let called = false;
  const result = await new SyncEngine(new CursorStore()).sync(empty, async () => { called = true; });
  assert.equal(called, false);
  assert.equal(result.pulled, 0);
  assert.equal(result.status, 'completed');
});

/* ─────────────────────── normalize ─────────────────────── */

test('normalizeMoney parses decimal major into minor units', () => {
  const m = normalizeMoney(rec('x', { amount: 12.34, currency: 'GBP' }), 'amount');
  assert.equal(m.amount, 1234);
  assert.equal(m.currency, 'GBP');
});

test('normalize maps every known kind', () => {
  assert.equal(normalize(rec('customer', { id: 'c1', name: 'Acme', arr: 100, currency: 'GBP', region: 'EU' })).kind, 'customer');
  assert.equal(normalize(rec('contract', { id: 'k1', customerId: 'c1', startDate: 'a', endDate: 'b', machineReadable: true })).kind, 'contract');
  assert.equal(normalize(rec('contractTerm', { id: 't1', contractId: 'k1', product: 'P', unitPrice: 10, currency: 'GBP', quantity: 2, billingPeriod: 'monthly' })).kind, 'contractTerm');
  assert.equal(normalize(rec('invoice', { id: 'i1', customerId: 'c1', issueDate: 'a', currency: 'GBP' })).kind, 'invoice');
  assert.equal(normalize(rec('invoiceLine', { id: 'l1', invoiceId: 'i1', product: 'P', amount: 10, currency: 'GBP', quantity: 1 })).kind, 'invoiceLine');
  assert.equal(normalize(rec('intent', { id: 'e1', customerId: 'c1', source: 'qbr', capturedAt: 'a', extractedSpan: 's', intentType: 'uplift', confidence: 0.9, deepLink: 'x' })).kind, 'intent');
});

test('normalize rejects an unknown kind', () => {
  assert.throws(() => normalize(rec('mystery', {})), ConnectorError);
});

test('toContractTerm defaults escalator and rejects bad period', () => {
  const t = toContractTerm(rec('contractTerm', { id: 't', contractId: 'k', product: 'P', unitPrice: 10, currency: 'GBP', quantity: 1, billingPeriod: 'annual' }));
  assert.equal(t.escalatorPercent, 0);
  assert.equal(t.billingPeriod, 'annual');
  assert.throws(() => toContractTerm(rec('contractTerm', { id: 't', contractId: 'k', product: 'P', unitPrice: 10, currency: 'GBP', quantity: 1, billingPeriod: 'weekly' })), ConnectorError);
});

test('toContractTerm reads an explicit escalator', () => {
  const t = toContractTerm(rec('contractTerm', { id: 't', contractId: 'k', product: 'P', unitPrice: 10, currency: 'GBP', quantity: 1, billingPeriod: 'monthly', escalatorPercent: 5 }));
  assert.equal(t.escalatorPercent, 5);
});

test('toContractTerm coerces a numeric-string escalator and treats null as default', () => {
  const fromString = toContractTerm(rec('contractTerm', { id: 't', contractId: 'k', product: 'P', unitPrice: 10, currency: 'GBP', quantity: 1, billingPeriod: 'monthly', escalatorPercent: '7.5' }));
  assert.equal(fromString.escalatorPercent, 7.5);
  const fromNull = toContractTerm(rec('contractTerm', { id: 't', contractId: 'k', product: 'P', unitPrice: 10, currency: 'GBP', quantity: 1, billingPeriod: 'monthly', escalatorPercent: null }));
  assert.equal(fromNull.escalatorPercent, 0);
});

test('toCommercialIntentEvent validates source, confidence range, optional uplift', () => {
  const base = { id: 'e', customerId: 'c', source: 'email', capturedAt: 'a', extractedSpan: 's', intentType: 'uplift', confidence: 0.8, deepLink: 'x' };
  const withUplift = toCommercialIntentEvent(rec('intent', { ...base, upliftPercent: 10 }));
  assert.equal(withUplift.upliftPercent, 10);
  const without = toCommercialIntentEvent(rec('intent', base));
  assert.equal('upliftPercent' in without, false);
  assert.throws(() => toCommercialIntentEvent(rec('intent', { ...base, source: 'sms' })), ConnectorError);
  assert.throws(() => toCommercialIntentEvent(rec('intent', { ...base, confidence: 2 })), ConnectorError);
});

test('field validators reject missing/invalid string and number fields', () => {
  assert.throws(() => toCustomer(rec('customer', { name: 'Acme', arr: 100, currency: 'GBP', region: 'EU' })), ConnectorError); // missing id
  assert.throws(() => toCustomer(rec('customer', { id: 'c', name: 'Acme', arr: 'notnum', currency: 'GBP', region: 'EU' })), ConnectorError); // bad number
});

test('numeric coercion accepts numeric strings; optional numbers reject junk', () => {
  const line = toInvoiceLine(rec('invoiceLine', { id: 'l', invoiceId: 'i', product: 'P', amount: '12.50', currency: 'GBP', quantity: '3' }));
  assert.equal(line.amount.amount, 1250);
  assert.equal(line.quantity, 3);
  assert.throws(() => toContractTerm(rec('contractTerm', { id: 't', contractId: 'k', product: 'P', unitPrice: 10, currency: 'GBP', quantity: 1, billingPeriod: 'monthly', escalatorPercent: 'junk' })), ConnectorError);
});

test('toContract / toInvoice map their fields', () => {
  assert.equal(toContract(rec('contract', { id: 'k', customerId: 'c', startDate: 'a', endDate: 'b', machineReadable: false })).machineReadable, false);
  assert.equal(toInvoice(rec('invoice', { id: 'i', customerId: 'c', issueDate: 'a', currency: 'USD' })).currency, 'USD');
});

test('reasonOf extracts message from Error and stringifies non-errors', () => {
  assert.equal(reasonOf(new Error('boom')), 'boom');
  assert.equal(reasonOf('plain'), 'plain');
});

test('normalizeBatch separates successes and rejects', () => {
  const batch = normalizeBatch([
    rec('customer', { id: 'c1', name: 'Acme', arr: 100, currency: 'GBP', region: 'EU' }),
    rec('mystery', {}),
    rec('customer', { name: 'NoId', arr: 100, currency: 'GBP', region: 'EU' }),
  ]);
  assert.equal(batch.normalized.length, 1);
  assert.equal(batch.rejects.length, 2);
});
