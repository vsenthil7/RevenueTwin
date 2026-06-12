/**
 * Peer benchmarking (S31).
 *
 * Positions a customer's leakage and recovery performance against industry bands so the CFO can
 * see "are we better or worse than peers?". Deterministic; bands are configurable reference data.
 */
import { toDecimal, type Money } from '../money/money.ts';

export class BenchmarkError extends Error {
  constructor(message: string) { super(message); this.name = 'BenchmarkError'; }
}

export type Industry = 'saas' | 'fintech' | 'telco' | 'media' | 'infrastructure';

/** Reference leakage band for an industry (as fraction of ARR). */
export interface LeakageBand {
  readonly industry: Industry;
  readonly p25: number; // 25th percentile leakage rate (best quartile = lower)
  readonly p50: number;
  readonly p75: number;
}

export const INDUSTRY_BANDS: Record<Industry, LeakageBand> = {
  saas:           { industry: 'saas',           p25: 0.008, p50: 0.015, p75: 0.025 },
  fintech:        { industry: 'fintech',        p25: 0.005, p50: 0.010, p75: 0.018 },
  telco:          { industry: 'telco',          p25: 0.012, p50: 0.022, p75: 0.035 },
  media:          { industry: 'media',          p25: 0.010, p50: 0.018, p75: 0.030 },
  infrastructure: { industry: 'infrastructure', p25: 0.009, p50: 0.016, p75: 0.028 },
};

export type Quartile = 'top' | 'second' | 'third' | 'bottom';

export interface BenchmarkResult {
  readonly industry: Industry;
  readonly leakageRate: number;     // observed leakage / ARR
  readonly quartile: Quartile;      // top = best (lowest leakage)
  readonly vsMedianPct: number;     // (rate - p50)/p50 * 100; negative = better than median
  readonly band: LeakageBand;
}

/** Position an observed leakage rate within an industry band. Lower leakage = better quartile. */
export function benchmarkLeakage(observedLeakage: Money, arr: Money, industry: Industry): BenchmarkResult {
  const arrMajor = toDecimal(arr);
  if (arrMajor <= 0) throw new BenchmarkError('ARR must be positive');
  const rate = toDecimal(observedLeakage) / arrMajor;
  const band = INDUSTRY_BANDS[industry];

  let quartile: Quartile;
  if (rate <= band.p25) quartile = 'top';
  else if (rate <= band.p50) quartile = 'second';
  else if (rate <= band.p75) quartile = 'third';
  else quartile = 'bottom';

  const vsMedianPct = Math.round(((rate - band.p50) / band.p50) * 10000) / 100;
  return { industry, leakageRate: Math.round(rate * 100000) / 100000, quartile, vsMedianPct, band };
}

/** Recovery maturity tier from recovery rate (recovered / detected). */
export type MaturityTier = 'leading' | 'established' | 'developing' | 'nascent';

export function recoveryMaturity(recoveryRate: number): MaturityTier {
  if (recoveryRate < 0 || recoveryRate > 1) throw new BenchmarkError('recoveryRate must be in [0,1]');
  if (recoveryRate >= 0.75) return 'leading';
  if (recoveryRate >= 0.5) return 'established';
  if (recoveryRate >= 0.25) return 'developing';
  return 'nascent';
}

/** Estimated annual upside of moving to the top-quartile leakage rate. */
export function topQuartileUpside(observedLeakage: Money, arr: Money, industry: Industry): Money {
  const band = INDUSTRY_BANDS[industry];
  const arrMajor = toDecimal(arr);
  const currentRate = toDecimal(observedLeakage) / arrMajor;
  const targetRate = band.p25;
  const improvement = Math.max(0, currentRate - targetRate);
  const upsideMajor = improvement * arrMajor;
  const exp = arr.currency === 'JPY' ? 0 : 2;
  return { amount: Math.round(upsideMajor * Math.pow(10, exp)), currency: arr.currency };
}
