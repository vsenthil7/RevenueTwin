import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UsageBillingError, tieredCharge, volumeCharge, computeUsageCharge,
  trueUp, burstCharge, expectedConsumption, consumptionLeakage, commitmentDiscount,
  type PricingTier, type Commitment,
} from '../../src/usage/consumption.ts';
import { money } from '../../src/money/money.ts';

// first 100 @ £1.00, next 900 (to 1000) @ £0.50, rest @ £0.25
const tiers: PricingTier[] = [
  { upTo: 100, unitPrice: money(100, 'GBP') },
  { upTo: 1000, unitPrice: money(50, 'GBP') },
  { upTo: null, unitPrice: money(25, 'GBP') },
];

test('tieredCharge graduates across tiers', () => {
  // 1200 units: 100*100 + 900*50 + 200*25 = 10000 + 45000 + 5000 = 60000
  assert.equal(tieredCharge(1200, tiers).amount, 60000);
  // within first tier
  assert.equal(tieredCharge(50, tiers).amount, 50 * 100);
  // zero units
  assert.equal(tieredCharge(0, tiers).amount, 0);
});

test('tieredCharge rejects negative units', () => {
  assert.throws(() => tieredCharge(-1, tiers), UsageBillingError);
});

test('tieredCharge throws when usage exceeds a bounded final tier', () => {
  const bounded: PricingTier[] = [{ upTo: 100, unitPrice: money(100, 'GBP') }];
  assert.throws(() => tieredCharge(200, bounded), UsageBillingError);
});

test('validateTiers rejects empty, mid unbounded, and non-increasing bounds', () => {
  assert.throws(() => tieredCharge(10, []), UsageBillingError);
  assert.throws(() => tieredCharge(10, [{ upTo: null, unitPrice: money(1, 'GBP') }, { upTo: 100, unitPrice: money(1, 'GBP') }]), UsageBillingError);
  assert.throws(() => tieredCharge(10, [{ upTo: 100, unitPrice: money(1, 'GBP') }, { upTo: 50, unitPrice: money(1, 'GBP') }]), UsageBillingError);
});

test('volumeCharge prices ALL units at the landing tier', () => {
  // 1500 units lands in the unbounded tier @ 0.25 -> 1500*25 = 37500
  assert.equal(volumeCharge(1500, tiers).amount, 37500);
  // 500 units lands in second tier @ 0.50 -> 500*50 = 25000
  assert.equal(volumeCharge(500, tiers).amount, 25000);
  // 100 units lands in first tier (<=100) -> 100*100
  assert.equal(volumeCharge(100, tiers).amount, 100 * 100);
  // zero units -> first tier price * 0 = 0
  assert.equal(volumeCharge(0, tiers).amount, 0);
});

test('volumeCharge rejects negative units', () => {
  assert.throws(() => volumeCharge(-1, tiers), UsageBillingError);
});

test('computeUsageCharge dispatches on model', () => {
  assert.equal(computeUsageCharge(1200, 'tiered', tiers).amount, 60000);
  assert.equal(computeUsageCharge(1500, 'volume', tiers).amount, 37500);
});

const commitment: Commitment = {
  committedUnits: 1000, committedAmount: money(500_00, 'GBP'),
  periodStart: '2026-01-01', periodEnd: '2026-01-31',
};

test('trueUp charges overage above commitment', () => {
  const t = trueUp(commitment, 1200, 'tiered', tiers);
  assert.equal(t.overageUnits, 200);
  // overage of 200 priced from the start of the overage tiers: 100@100 + 100@50 = 15000
  assert.equal(t.overageCharge.amount, 100 * 100 + 100 * 50);
  assert.equal(t.totalDue.amount, t.overageCharge.amount);
  assert.equal(t.shortfall, 0);
});

test('trueUp reports shortfall when under commitment', () => {
  const t = trueUp(commitment, 800, 'tiered', tiers);
  assert.equal(t.overageUnits, 0);
  assert.equal(t.shortfall, 200);
  assert.equal(t.totalDue.amount, 0);
});

test('trueUp rejects negative actual units', () => {
  assert.throws(() => trueUp(commitment, -1, 'tiered', tiers), UsageBillingError);
});

test('burstCharge prices peak above included capacity', () => {
  const policy = { includedPeak: 100, burstUnitPrice: money(10_00, 'GBP') };
  assert.equal(burstCharge(150, policy).amount, 50 * 1000);
  assert.equal(burstCharge(80, policy).amount, 0); // under included
  assert.throws(() => burstCharge(-1, policy), UsageBillingError);
});

test('expectedConsumption sums base + true-up + burst', () => {
  const total = expectedConsumption(money(100_00, 'GBP'), money(50_00, 'GBP'), money(20_00, 'GBP'));
  assert.equal(total.amount, 170_00);
});

test('consumptionLeakage = expected - invoiced, floored at zero', () => {
  assert.equal(consumptionLeakage(money(170_00, 'GBP'), money(150_00, 'GBP')).amount, 20_00);
  assert.equal(consumptionLeakage(money(150_00, 'GBP'), money(150_00, 'GBP')).amount, 0);
  assert.equal(consumptionLeakage(money(100_00, 'GBP'), money(150_00, 'GBP')).amount, 0); // over-billed -> 0
});

test('commitmentDiscount reduces committed spend by percent', () => {
  assert.equal(commitmentDiscount(money(1000_00, 'GBP'), 10).amount, 900_00);
});
