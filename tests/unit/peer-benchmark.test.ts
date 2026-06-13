import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BenchmarkError, INDUSTRY_BANDS, benchmarkLeakage, recoveryMaturity, topQuartileUpside,
} from '../../src/benchmarking/peer-benchmark.ts';
import { money } from '../../src/money/money.ts';

test('benchmarkLeakage assigns quartiles by leakage rate', () => {
  const arr = money(1_000_000_00, 'GBP'); // £1M ARR
  // saas band p25 0.008, p50 0.015, p75 0.025
  assert.equal(benchmarkLeakage(money(5_000_00, 'GBP'), arr, 'saas').quartile, 'top');    // 0.5%
  assert.equal(benchmarkLeakage(money(12_000_00, 'GBP'), arr, 'saas').quartile, 'second'); // 1.2%
  assert.equal(benchmarkLeakage(money(20_000_00, 'GBP'), arr, 'saas').quartile, 'third');  // 2.0%
  assert.equal(benchmarkLeakage(money(40_000_00, 'GBP'), arr, 'saas').quartile, 'bottom'); // 4.0%
});

test('benchmarkLeakage computes vs-median and reflects the band', () => {
  const r = benchmarkLeakage(money(15_000_00, 'GBP'), money(1_000_000_00, 'GBP'), 'saas');
  assert.equal(r.leakageRate, 0.015);
  assert.equal(r.vsMedianPct, 0); // exactly at p50
  assert.equal(r.band, INDUSTRY_BANDS.saas);
});

test('benchmarkLeakage rejects non-positive ARR', () => {
  assert.throws(() => benchmarkLeakage(money(100, 'GBP'), money(0, 'GBP'), 'saas'), BenchmarkError);
});

test('recoveryMaturity tiers', () => {
  assert.equal(recoveryMaturity(0.8), 'leading');
  assert.equal(recoveryMaturity(0.6), 'established');
  assert.equal(recoveryMaturity(0.3), 'developing');
  assert.equal(recoveryMaturity(0.1), 'nascent');
});

test('recoveryMaturity rejects out-of-range rate', () => {
  assert.throws(() => recoveryMaturity(-0.1), BenchmarkError);
  assert.throws(() => recoveryMaturity(1.5), BenchmarkError);
});

test('topQuartileUpside computes annual improvement potential', () => {
  // current 2% leakage, target p25 0.8% on £1M -> improvement 1.2% * 1,000,000 = 12,000
  const upside = topQuartileUpside(money(20_000_00, 'GBP'), money(1_000_000_00, 'GBP'), 'saas');
  assert.equal(upside.amount, 12_000_00);
  assert.equal(upside.currency, 'GBP');
});

test('topQuartileUpside is zero when already top quartile', () => {
  const upside = topQuartileUpside(money(5_000_00, 'GBP'), money(1_000_000_00, 'GBP'), 'saas');
  assert.equal(upside.amount, 0);
});

test('topQuartileUpside respects zero-decimal currencies (JPY)', () => {
  const upside = topQuartileUpside(money(20_000_000, 'JPY'), money(1_000_000_000, 'JPY'), 'saas');
  // rate 0.02, improvement to p25 (0.008) = 0.012; JPY uses exp 0 so amount stays in major-unit scale
  assert.equal(upside.currency, 'JPY');
  assert.equal(upside.amount, 120000);
});
