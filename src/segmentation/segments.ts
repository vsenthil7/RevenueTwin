/**
 * Customer segmentation (S43).
 *
 * Tiers customers by ARR, computes a composite health score, and rolls a portfolio into cohorts.
 * Drives prioritization (which leakage to chase first) and at-risk focus. Deterministic.
 */
import { money, add, compare, toDecimal, type Money } from '../money/money.ts';

export class SegmentationError extends Error {
  constructor(message: string) { super(message); this.name = 'SegmentationError'; }
}

export type Tier = 'strategic' | 'enterprise' | 'mid_market' | 'smb';

export interface TierBands {
  readonly strategicMin: Money;
  readonly enterpriseMin: Money;
  readonly midMarketMin: Money;
}

/** Classify a customer's ARR into a tier (descending thresholds; below mid-market => smb). */
export function classifyTier(arr: Money, bands: TierBands): Tier {
  if (compare(arr, bands.strategicMin) >= 0) return 'strategic';
  if (compare(arr, bands.enterpriseMin) >= 0) return 'enterprise';
  if (compare(arr, bands.midMarketMin) >= 0) return 'mid_market';
  return 'smb';
}

export interface HealthInputs {
  readonly paymentTimeliness: number; // 0..1 (1 = always on time)
  readonly supportSatisfaction: number; // 0..1
  readonly productAdoption: number; // 0..1
  readonly openDisputes: number; // count
}

/**
 * Composite health score 0..1: weighted blend of timeliness/satisfaction/adoption, penalized by
 * open disputes (each dispute subtracts 0.05, floored at 0).
 */
export function healthScore(h: HealthInputs): number {
  for (const [k, v] of Object.entries({ paymentTimeliness: h.paymentTimeliness, supportSatisfaction: h.supportSatisfaction, productAdoption: h.productAdoption })) {
    if (v < 0 || v > 1) throw new SegmentationError(`${k} must be in [0,1]`);
  }
  if (h.openDisputes < 0) throw new SegmentationError('openDisputes must be >= 0');
  const base = 0.4 * h.paymentTimeliness + 0.3 * h.supportSatisfaction + 0.3 * h.productAdoption;
  const penalty = Math.min(base, h.openDisputes * 0.05);
  return Math.round((base - penalty) * 1000) / 1000;
}

export type HealthBand = 'healthy' | 'watch' | 'at_risk';

export function healthBand(score: number): HealthBand {
  if (score >= 0.7) return 'healthy';
  if (score >= 0.4) return 'watch';
  return 'at_risk';
}

export interface SegmentedCustomer {
  readonly customerId: string;
  readonly arr: Money;
  readonly tier: Tier;
  readonly health: number;
  readonly band: HealthBand;
}

export function segment(customerId: string, arr: Money, bands: TierBands, h: HealthInputs): SegmentedCustomer {
  const score = healthScore(h);
  return { customerId, arr, tier: classifyTier(arr, bands), health: score, band: healthBand(score) };
}

export interface CohortRollup {
  readonly tier: Tier;
  readonly count: number;
  readonly totalArr: Money;
  readonly avgHealth: number;
  readonly atRiskCount: number;
}

/** Roll a segmented portfolio into per-tier cohorts. */
export function cohortRollup(customers: SegmentedCustomer[], currency: string): CohortRollup[] {
  const tiers: Tier[] = ['strategic', 'enterprise', 'mid_market', 'smb'];
  const out: CohortRollup[] = [];
  for (const tier of tiers) {
    const members = customers.filter((c) => c.tier === tier);
    if (members.length === 0) continue;
    const totalArr = members.reduce<Money>((acc, c) => add(acc, c.arr), money(0, currency));
    const avgHealth = members.reduce((s, c) => s + c.health, 0) / members.length;
    const atRiskCount = members.filter((c) => c.band === 'at_risk').length;
    out.push({ tier, count: members.length, totalArr, avgHealth: Math.round(avgHealth * 1000) / 1000, atRiskCount });
  }
  return out;
}

/**
 * Priority score for leakage triage: weight recoverable by tier and inverse health (chase
 * high-value, lower-health accounts first). Returns a comparable numeric score.
 */
export function triagePriority(recoverable: Money, customer: SegmentedCustomer): number {
  const tierWeight: Record<Tier, number> = { strategic: 1.5, enterprise: 1.25, mid_market: 1.0, smb: 0.75 };
  const healthFactor = 1 + (1 - customer.health); // worse health -> higher priority
  return Math.round(toDecimal(recoverable) * tierWeight[customer.tier] * healthFactor * 100) / 100;
}
