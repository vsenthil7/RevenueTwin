import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importCsv, rowToVarianceInput, ImportError, REQUIRED_COLUMNS } from '../../src/import/importer.ts';

const HEADER = 'customer,line_id,type,expected,actual,currency,confidence,age_days,name';
const NOW = () => '2026-06-13T00:00:00.000Z';

test('importCsv: produces findings, groups by customer, sums recoverable', () => {
  const csv = [HEADER,
    'Acme,INV-1,price_changed,12000,10800,GBP,0.95,45,Q1',
    'Acme,INV-2,missed_escalator,8400,8000,GBP,0.9,60,CPI',
    'Globex,INV-3,unbilled_usage,5000,0,GBP,0.85,20,API',
  ].join('\n');
  const r = importCsv(csv, { now: NOW });
  assert.equal(r.rowsAccepted, 3);
  assert.equal(r.rowsRejected, 0);
  assert.equal(r.cases.length, 2);
  assert.equal(r.currency, 'GBP');
  // summaries sorted desc by recoverable; Globex (biggest gross) leads
  assert.equal(r.summaries[0]!.customerId, 'Globex');
  assert.ok(r.totalRecoverable.amount > 0);
  assert.equal(r.totalRecoverable.currency, 'GBP');
});

test('importCsv: clean line (expected===actual) yields no finding but counts as accepted', () => {
  const csv = [HEADER, 'Acme,INV-1,invoice,3000,3000,GBP,0.9,10,clean'].join('\n');
  const r = importCsv(csv, { now: NOW });
  assert.equal(r.rowsAccepted, 1);
  assert.equal(r.cases.length, 0);
  assert.equal(r.totalRecoverable.amount, 0);
  assert.equal(r.totalRecoverableFormatted, 'GBP 0.00');
});

test('importCsv: time-barred row (age beyond window) yields no finding', () => {
  const csv = [HEADER, 'Acme,INV-1,tax,2200,1900,GBP,0.8,99999,old'].join('\n');
  const r = importCsv(csv, { now: NOW });
  assert.equal(r.rowsAccepted, 1);
  assert.equal(r.cases.length, 0);
});

test('importCsv: invalid type is rejected with row number', () => {
  const csv = [HEADER, 'Acme,INV-1,not_a_type,100,50,GBP,0.9,10,x'].join('\n');
  const r = importCsv(csv, { now: NOW });
  assert.equal(r.rowsRejected, 1);
  assert.equal(r.rejects[0]!.row, 2);
  assert.match(r.rejects[0]!.reason, /invalid type/);
});

test('importCsv: mixed currencies are rejected per row', () => {
  const csv = [HEADER,
    'Acme,INV-1,price_changed,12000,10800,GBP,0.95,45,a',
    'Acme,INV-2,price_changed,12000,10800,USD,0.95,45,b',
  ].join('\n');
  const r = importCsv(csv, { now: NOW });
  assert.equal(r.rowsRejected, 1);
  assert.match(r.rejects[0]!.reason, /mixed currencies/);
});

test('importCsv: missing required column throws', () => {
  const csv = ['customer,line_id,type,expected,actual', 'Acme,INV-1,price_changed,1,0'].join('\n');
  assert.throws(() => importCsv(csv, { now: NOW }), /missing required column/);
});

test('importCsv: empty CSV throws', () => {
  assert.throws(() => importCsv('   ', { now: NOW }), /no data rows/);
});

test('importCsv: missing customer / currency rejected', () => {
  const csv = [HEADER,
    ',INV-1,price_changed,12000,10800,GBP,0.9,45,a',
    'Acme,INV-2,price_changed,12000,10800,,0.9,45,b',
  ].join('\n');
  const r = importCsv(csv, { now: NOW });
  assert.equal(r.rowsRejected, 2);
});

test('importCsv: missing expected/actual/line_id rejected', () => {
  const csv = [HEADER,
    'Acme,INV-1,price_changed,,10800,GBP,0.9,45,a',
    'Acme,,price_changed,12000,10800,GBP,0.9,45,b',
    'Acme,INV-3,price_changed,notnum,10800,GBP,0.9,45,c',
  ].join('\n');
  const r = importCsv(csv, { now: NOW });
  assert.equal(r.rowsRejected, 3);
});

test('importCsv: default now used when not supplied', () => {
  const csv = [HEADER, 'Acme,INV-1,price_changed,12000,10800,GBP,0.95,45,a'].join('\n');
  const r = importCsv(csv);
  assert.equal(r.cases.length, 1);
  assert.ok(r.cases[0]!.createdAt.length > 0);
});

test('rowToVarianceInput: optional fields default and parse', () => {
  // no confidence/age/strength/field/name -> defaults applied
  const vi = rowToVarianceInput({ customer: 'A', line_id: 'L1', type: 'price_changed', expected: '100', actual: '80', currency: 'GBP' }, 2, 'GBP');
  assert.equal(vi.confidence, 0.9);
  assert.equal(vi.ageDays, 30);
  assert.equal(vi.contractStrength, undefined);
  // with all optionals present
  const vi2 = rowToVarianceInput({ customer: 'A', line_id: 'L2', type: 'tax', expected: '100', actual: '80', currency: 'GBP', confidence: '0.7', age_days: '10', contract_strength: '0.8', field: 'rate', name: 'VAT' }, 3, 'GBP');
  assert.equal(vi2.confidence, 0.7);
  assert.equal(vi2.contractStrength, 0.8);
  assert.equal(vi2.field, 'rate');
  assert.equal(vi2.name, 'VAT');
});

test('rowToVarianceInput: non-numeric optional throws', () => {
  assert.throws(() => rowToVarianceInput({ customer: 'A', line_id: 'L1', type: 'tax', expected: '100', actual: '80', currency: 'GBP', confidence: 'abc' }, 2, 'GBP'), /not a number/);
});

test('REQUIRED_COLUMNS is the documented contract', () => {
  assert.deepEqual([...REQUIRED_COLUMNS], ['customer', 'line_id', 'type', 'expected', 'actual', 'currency']);
});

test('ImportError carries its name', () => {
  const e = new ImportError('x'); assert.equal(e.name, 'ImportError');
});

test('importCsv: applies a column mapping so buyer-named headers import correctly (S66)', () => {
  // Buyer file uses THEIR own headers; a mapping renames them to our canonical columns.
  const csv = ['Account,Invoice Number,Category,Expected Amount,Invoice Amount,CCY',
    'Acme,INV-9,price_changed,12000,10800,GBP',
  ].join('\n');
  const mapping = {
    Account: 'customer', 'Invoice Number': 'line_id', Category: 'type',
    'Expected Amount': 'expected', 'Invoice Amount': 'actual', CCY: 'currency',
  };
  const res = importCsv(csv, { now: NOW, mapping });
  assert.equal(res.cases.length, 1);
  assert.equal(res.rowsAccepted, 1);
  assert.ok(res.totalRecoverable.amount > 0);
});
