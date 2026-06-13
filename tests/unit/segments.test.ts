import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SegmentationError, classifyTier, healthScore, healthBand, segment, cohortRollup, triagePriority,
  type TierBands, type HealthInputs, type SegmentedCustomer,
} from '../../src/segmentation/segments.ts';
import { money } from '../../src/money/money.ts';

const bands: TierBands = {
  strategicMin: money(1_000_000_00, 'GBP'),
  enterpriseMin: money(250_000_00, 'GBP'),
  midMarketMin: money(50_000_00, 'GBP'),
};

function health(over: Partial<HealthInputs> = {}): HealthInputs {
  return { paymentTimeliness: 1, supportSatisfaction: 1, productAdoption: 1, openDisputes: 0, ...over };
}

test('classifyTier assigns by descending ARR thresholds', () => {
  assert.equal(classifyTier(money(2_000_000_00, 'GBP'), bands), 'strategic');
  assert.equal(classifyTier(money(300_000_00, 'GBP'), bands), 'enterprise');
  assert.equal(classifyTier(money(60_000_00, 'GBP'), bands), 'mid_market');
  assert.equal(classifyTier(money(10_000_00, 'GBP'), bands), 'smb');
});

test('healthScore blends inputs and penalizes disputes', () => {
  assert.equal(healthScore(health()), 1); // all perfect, no disputes
  // 2 disputes -> penalty 0.10
  assert.equal(healthScore(health({ openDisputes: 2 })), 0.9);
});

test('healthScore penalty is floored so score never goes negative', () => {
  // base would be low, many disputes -> penalty capped at base, score 0
  const s = healthScore(health({ paymentTimeliness: 0.2, supportSatisfaction: 0.2, productAdoption: 0.2, openDisputes: 100 }));
  assert.equal(s, 0);
});

test('healthScore validates input ranges', () => {
  assert.throws(() => healthScore(health({ paymentTimeliness: 1.5 })), SegmentationError);
  assert.throws(() => healthScore(health({ supportSatisfaction: -0.1 })), SegmentationError);
  assert.throws(() => healthScore(health({ productAdoption: 2 })), SegmentationError);
  assert.throws(() => healthScore(health({ openDisputes: -1 })), SegmentationError);
});

test('healthBand thresholds', () => {
  assert.equal(healthBand(0.8), 'healthy');
  assert.equal(healthBand(0.5), 'watch');
  assert.equal(healthBand(0.2), 'at_risk');
});

test('segment composes tier + health + band', () => {
  const s = segment('c1', money(300_000_00, 'GBP'), bands, health({ openDisputes: 8 }));
  assert.equal(s.tier, 'enterprise');
  assert.equal(s.band, 'watch'); // 1 - 0.4 = 0.6
  assert.equal(s.health, 0.6);
});

function seg(id: string, tier: SegmentedCustomer['tier'], arr: number, healthVal: number, band: SegmentedCustomer['band']): SegmentedCustomer {
  return { customerId: id, arr: money(arr, 'GBP'), tier, health: healthVal, band };
}

test('cohortRollup aggregates per tier and skips empty tiers', () => {
  const customers = [
    seg('a', 'strategic', 1_000_000_00, 0.9, 'healthy'),
    seg('b', 'strategic', 2_000_000_00, 0.3, 'at_risk'),
    seg('c', 'smb', 10_000_00, 0.8, 'healthy'),
  ];
  const rollup = cohortRollup(customers, 'GBP');
  // enterprise + mid_market empty -> skipped
  assert.deepEqual(rollup.map((r) => r.tier), ['strategic', 'smb']);
  const strat = rollup.find((r) => r.tier === 'strategic')!;
  assert.equal(strat.count, 2);
  assert.equal(strat.totalArr.amount, 3_000_000_00);
  assert.equal(strat.atRiskCount, 1);
  assert.equal(strat.avgHealth, 0.6);
});

test('triagePriority weights by tier and inverse health', () => {
  const strategic = seg('a', 'strategic', 1_000_000_00, 0.2, 'at_risk');
  const smb = seg('b', 'smb', 10_000_00, 0.2, 'at_risk');
  const pStrategic = triagePriority(money(1000_00, 'GBP'), strategic);
  const pSmb = triagePriority(money(1000_00, 'GBP'), smb);
  assert.ok(pStrategic > pSmb); // strategic weighted higher for same recoverable + health
});
