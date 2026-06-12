import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  intentVarianceInput, lineAnnualValue, recall, WORKIQ_ON, WORKIQ_OFF,
} from '../../src/intent/workiq.ts';
import { NORTHWIND } from '../../src/core/golden-thread.ts';
import { buildFinding } from '../../src/core/reconciliation.ts';
import { money } from '../../src/money/money.ts';
import type { CommercialIntentEvent, ContractTerm } from '../../src/core/model.ts';

const TERM = NORTHWIND.term;
const QBR = NORTHWIND.qbrEvent;

test('lineAnnualValue annualizes monthly terms', () => {
  // £1,000.00 × 1 × 12 = £12,000.00 = 1,200,000 minor
  assert.equal(lineAnnualValue(TERM).amount, 1_200_000);
});

test('lineAnnualValue treats annual terms as 1 period', () => {
  const annual: ContractTerm = { ...TERM, billingPeriod: 'annual' };
  assert.equal(lineAnnualValue(annual).amount, 100_000);
});

test('MOAT: blind (Work IQ OFF) detects nothing on the planted leak', () => {
  const v = intentVarianceInput(QBR, TERM, NORTHWIND.billedUplift, NORTHWIND.ageDays, WORKIQ_OFF);
  assert.equal(v, null);
});

test('MOAT: sighted (Work IQ ON) detects exactly the £1,200.00 leak', () => {
  const v = intentVarianceInput(QBR, TERM, NORTHWIND.billedUplift, NORTHWIND.ageDays, WORKIQ_ON);
  assert.ok(v);
  const finding = buildFinding(v!);
  assert.ok(finding);
  // Exact, load-bearing: the demos assert 120000 minor = £1,200.00.
  assert.equal(finding!.netRecoverable.amount, 120_000);
  assert.equal(finding!.netRecoverable.currency, 'GBP');
  assert.equal(finding!.type, 'intent');
});

test('MOAT: recall delta is 0 (blind) vs 1 (sighted)', () => {
  const events = [{ event: QBR, term: TERM, billed: NORTHWIND.billedUplift, ageDays: NORTHWIND.ageDays }];
  assert.equal(recall(events, WORKIQ_OFF), 0);
  assert.equal(recall(events, WORKIQ_ON), 1);
});

test('rejects below-confidence signals', () => {
  const weak: CommercialIntentEvent = { ...QBR, confidence: 0.5 };
  assert.equal(intentVarianceInput(weak, TERM, 0, 0, WORKIQ_ON), null);
});

test('rejects signals with no agreed uplift', () => {
  const noUplift: CommercialIntentEvent = { ...QBR, upliftPercent: undefined };
  assert.equal(intentVarianceInput(noUplift, TERM, 0, 0, WORKIQ_ON), null);
  const zeroUplift: CommercialIntentEvent = { ...QBR, upliftPercent: 0 };
  assert.equal(intentVarianceInput(zeroUplift, TERM, 0, 0, WORKIQ_ON), null);
});

test('rejects when the agreed uplift was already billed (no variance)', () => {
  // billed 10% >= agreed 10%
  assert.equal(intentVarianceInput(QBR, TERM, 10, 0, WORKIQ_ON), null);
  // billed exceeds agreed
  assert.equal(intentVarianceInput(QBR, TERM, 12, 0, WORKIQ_ON), null);
});

test('partial prior billing still surfaces the remaining variance', () => {
  // agreed 10%, billed 4% -> expected 10% of 1.2M = 120000, actual 4% = 48000 -> gross 72000
  const v = intentVarianceInput(QBR, TERM, 4, 0, WORKIQ_ON);
  assert.ok(v);
  assert.equal(v!.expected.amount, 120_000);
  assert.equal(v!.actual.amount, 48_000);
  const f = buildFinding(v!);
  assert.equal(f!.netRecoverable.amount, 72_000);
});

test('variance carries evidence-linked naming and field', () => {
  const v = intentVarianceInput(QBR, TERM, 0, 0, WORKIQ_ON)!;
  assert.equal(v.field, 'upliftPercent');
  assert.match(v.name!, /Agreed 10% uplift not billed \(qbr\)/);
  assert.equal(v.id, 'intent-northwind-qbr-2026Q1');
});
