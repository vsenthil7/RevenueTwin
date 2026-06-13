import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChurnError, decomposeRetention, logoChurnRate, expansionBillingGap, revenueQuickRatio,
  type CustomerRevenue, type RetentionDecomposition,
} from '../../src/churn/retention.ts';
import { money } from '../../src/money/money.ts';

function cust(id: string, start: number, end: number): CustomerRevenue {
  return { customerId: id, startArr: money(start, 'GBP'), endArr: money(end, 'GBP') };
}

test('decomposeRetention splits expansion / contraction / churn', () => {
  const cohort = [
    cust('a', 100_00, 120_00), // +20 expansion
    cust('b', 100_00, 80_00),  // -20 contraction
    cust('c', 100_00, 0),      // churn 100
    cust('d', 100_00, 100_00), // flat
  ];
  const d = decomposeRetention(cohort, 'GBP');
  assert.equal(d.startingArr.amount, 400_00);
  assert.equal(d.expansion.amount, 20_00);
  assert.equal(d.contraction.amount, 20_00);
  assert.equal(d.churn.amount, 100_00);
  // ending from base = 400 + 20 - 20 - 100 = 300
  assert.equal(d.endingArrFromBase.amount, 300_00);
  // grr = (400 - 20 - 100)/400 = 0.7 ; nrr = 300/400 = 0.75
  assert.equal(d.grr, 0.7);
  assert.equal(d.nrr, 0.75);
});

test('decomposeRetention handles an all-zero starting cohort', () => {
  const d = decomposeRetention([cust('a', 0, 0)], 'GBP');
  assert.equal(d.grr, 0);
  assert.equal(d.nrr, 0);
});

test('decomposeRetention rejects mixed currencies', () => {
  const mixed: CustomerRevenue[] = [{ customerId: 'a', startArr: money(100, 'GBP'), endArr: money(100, 'USD') }];
  assert.throws(() => decomposeRetention(mixed, 'GBP'), ChurnError);
});

test('logoChurnRate is fraction fully churned; empty -> 0', () => {
  assert.equal(logoChurnRate([cust('a', 100, 0), cust('b', 100, 50), cust('c', 100, 0), cust('d', 100, 100)]), 0.5);
  assert.equal(logoChurnRate([]), 0);
});

test('expansionBillingGap surfaces unbilled agreed expansion', () => {
  assert.equal(expansionBillingGap(money(50_00, 'GBP'), money(30_00, 'GBP')).amount, 20_00);
  assert.equal(expansionBillingGap(money(30_00, 'GBP'), money(30_00, 'GBP')).amount, 0); // no gap
  assert.equal(expansionBillingGap(money(10_00, 'GBP'), money(30_00, 'GBP')).amount, 0); // observed exceeds agreed
});

test('revenueQuickRatio: ratio, zero-downside infinity, zero-zero', () => {
  const withDownside: RetentionDecomposition = {
    startingArr: money(0, 'GBP'), expansion: money(40_00, 'GBP'), contraction: money(10_00, 'GBP'),
    churn: money(10_00, 'GBP'), endingArrFromBase: money(0, 'GBP'), grr: 0, nrr: 0,
  };
  assert.equal(revenueQuickRatio(withDownside), 2); // 40 / (10+10)
  const noDownside: RetentionDecomposition = { ...withDownside, contraction: money(0, 'GBP'), churn: money(0, 'GBP') };
  assert.equal(revenueQuickRatio(noDownside), Infinity);
  const nothing: RetentionDecomposition = { ...noDownside, expansion: money(0, 'GBP') };
  assert.equal(revenueQuickRatio(nothing), 0);
});
