import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AmendmentError, diffTerms, materialChanges, netAmendmentImpact, amendmentBillingGap,
} from '../../src/amendments/diff.ts';
import { money } from '../../src/money/money.ts';
import type { ContractTerm } from '../../src/core/model.ts';

function term(over: Partial<ContractTerm> = {}): ContractTerm {
  return { id: 't1', contractId: 'k', product: 'P', unitPrice: money(100_00, 'GBP'), quantity: 1, billingPeriod: 'monthly', escalatorPercent: 0, ...over };
}

test('diffTerms classifies added and removed', () => {
  const deltas = diffTerms([term({ id: 'gone' })], [term({ id: 'new' })]);
  const added = deltas.find((d) => d.termId === 'new')!;
  const removed = deltas.find((d) => d.termId === 'gone')!;
  assert.equal(added.kind, 'added');
  assert.equal(added.valueImpact.amount, 100_00 * 12); // monthly annualized
  assert.equal(removed.kind, 'removed');
  assert.equal(removed.valueImpact.amount, -(100_00 * 12));
});

test('diffTerms classifies price / quantity / escalator / unchanged with precedence', () => {
  const base = term();
  const price = diffTerms([base], [term({ unitPrice: money(120_00, 'GBP') })])[0]!;
  assert.equal(price.kind, 'price_changed');
  assert.equal(price.valueImpact.amount, (120_00 - 100_00) * 12);
  const qty = diffTerms([base], [term({ quantity: 3 })])[0]!;
  assert.equal(qty.kind, 'quantity_changed');
  const esc = diffTerms([base], [term({ escalatorPercent: 5 })])[0]!;
  assert.equal(esc.kind, 'escalator_changed');
  const same = diffTerms([base], [term()])[0]!;
  assert.equal(same.kind, 'unchanged');
});

test('diffTerms annualizes annual-period terms without ×12', () => {
  const annual = term({ billingPeriod: 'annual' });
  const d = diffTerms([], [annual])[0]!;
  assert.equal(d.valueImpact.amount, 100_00);
});

test('diffTerms rejects a currency change on a term', () => {
  assert.throws(() => diffTerms([term()], [term({ unitPrice: money(100_00, 'USD') })]), AmendmentError);
});

test('materialChanges drops unchanged deltas', () => {
  const deltas = diffTerms([term(), term({ id: 't2' })], [term({ unitPrice: money(120_00, 'GBP') }), term({ id: 't2' })]);
  const material = materialChanges(deltas);
  assert.equal(material.length, 1);
  assert.equal(material[0]!.kind, 'price_changed');
});

test('netAmendmentImpact sums value impacts', () => {
  const deltas = diffTerms([term()], [term({ unitPrice: money(110_00, 'GBP') })]);
  assert.equal(netAmendmentImpact(deltas, 'GBP').amount, (110_00 - 100_00) * 12);
});

test('amendmentBillingGap finds terms whose amended value exceeds billed', () => {
  const amended = [term({ unitPrice: money(120_00, 'GBP') }), term({ id: 't2', unitPrice: money(50_00, 'GBP') })];
  const billed = [term({ unitPrice: money(100_00, 'GBP') })]; // t2 not billed at all
  const leaks = amendmentBillingGap(amended, billed);
  const t1 = leaks.find((l) => l.termId === 't1')!;
  const t2 = leaks.find((l) => l.termId === 't2')!;
  assert.equal(t1.gap.amount, (120_00 - 100_00) * 12);
  assert.equal(t2.billedAnnual.amount, 0); // unbilled term
  assert.equal(t2.gap.amount, 50_00 * 12);
});

test('amendmentBillingGap omits terms with no gap', () => {
  const amended = [term()];
  const billed = [term()];
  assert.equal(amendmentBillingGap(amended, billed).length, 0);
});
