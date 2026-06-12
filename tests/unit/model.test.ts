import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CASE_TRANSITIONS, canTransition, isTerminal,
  type LeakageCase, type VarianceFinding, type CommercialIntentEvent,
  type Customer, type Contract, type ContractTerm, type Invoice, type InvoiceLine,
  type Renewal, type CaseStatus,
} from '../../src/core/model.ts';
import { money } from '../../src/money/money.ts';

test('entities are structurally constructible with their exact fields', () => {
  const customer: Customer = { id: 'c1', name: 'Acme', arr: money(120000_00, 'GBP'), region: 'EU' };
  const contract: Contract = { id: 'k1', customerId: 'c1', startDate: '2026-01-01', endDate: '2027-01-01', machineReadable: true };
  const term: ContractTerm = { id: 't1', contractId: 'k1', product: 'Pro', unitPrice: money(100_00, 'GBP'), quantity: 10, billingPeriod: 'monthly', escalatorPercent: 5 };
  const invoice: Invoice = { id: 'i1', customerId: 'c1', issueDate: '2026-02-01', currency: 'GBP' };
  const line: InvoiceLine = { id: 'l1', invoiceId: 'i1', product: 'Pro', amount: money(900_00, 'GBP'), quantity: 9 };
  const renewal: Renewal = { id: 'r1', contractId: 'k1', currentEndDate: '2027-01-01', escalatorApplied: false };
  assert.equal(customer.arr.amount, 120000_00);
  assert.equal(contract.machineReadable, true);
  assert.equal(term.billingPeriod, 'monthly');
  assert.equal(invoice.currency, 'GBP');
  assert.equal(line.quantity, 9);
  assert.equal(renewal.escalatorApplied, false);
});

test('commercial intent event carries evidence and optional uplift', () => {
  const ev: CommercialIntentEvent = {
    id: 'e1', customerId: 'c1', source: 'email', capturedAt: '2026-03-01',
    extractedSpan: 'agreed 10% uplift', intentType: 'price_increase', upliftPercent: 10,
    confidence: 0.9, deepLink: 'https://mail/x',
  };
  assert.equal(ev.upliftPercent, 10);
  assert.equal(ev.source, 'email');
});

test('variance finding carries net recoverable and optional context', () => {
  const f: VarianceFinding = {
    id: 'f1', type: 'price_changed', netRecoverable: money(1200_00, 'GBP'),
    field: 'unitPrice', name: 'Uplift not billed', expected: money(110_00, 'GBP'), actual: money(100_00, 'GBP'),
  };
  assert.equal(f.netRecoverable.amount, 1200_00);
  assert.equal(f.field, 'unitPrice');
});

test('leakage case mutable status, immutable identity', () => {
  const c: LeakageCase = {
    id: 'case1', customerId: 'c1',
    findings: [{ id: 'f1', type: 'intent', netRecoverable: money(500_00, 'GBP') }],
    status: 'open', createdAt: '2026-03-01', detectedViaWorkIQ: true,
  };
  c.status = 'approved';
  assert.equal(c.status, 'approved');
  assert.equal(c.detectedViaWorkIQ, true);
});

test('canTransition allows legal forward moves and blocks illegal', () => {
  assert.equal(canTransition('open', 'approved'), true);
  assert.equal(canTransition('approved', 'recovered'), true);
  assert.equal(canTransition('open', 'recovered'), false);
  assert.equal(canTransition('recovered', 'open'), false);
});

test('isTerminal true only for terminal states', () => {
  const terminal: CaseStatus[] = ['recovered', 'rejected', 'written_off'];
  for (const s of Object.keys(CASE_TRANSITIONS) as CaseStatus[]) {
    assert.equal(isTerminal(s), terminal.includes(s));
  }
});

test('every transition target is itself a known status (no dangling states)', () => {
  const known = new Set(Object.keys(CASE_TRANSITIONS));
  for (const targets of Object.values(CASE_TRANSITIONS)) {
    for (const t of targets) assert.ok(known.has(t));
  }
});
