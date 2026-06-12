/**
 * Usage / consumption billing (S29).
 *
 * Modern SaaS revenue is metered: tiered or volume pricing, prepaid commitments with true-ups,
 * and burst overage. This module computes expected charges from usage deterministically (integer
 * minor units), so consumption leakage (under-billed overage, un-trued-up commitments) is
 * detectable by the reconciliation core like any other variance.
 */
import { money, add, subtract, multiplyByQuantity, applyPercentage, compare, type Money } from '../money/money.ts';

export class UsageBillingError extends Error {
  constructor(message: string) { super(message); this.name = 'UsageBillingError'; }
}

/** A pricing tier: [upTo) units priced at unitPrice. `upTo: null` = unbounded final tier. */
export interface PricingTier {
  readonly upTo: number | null;
  readonly unitPrice: Money;
}

export type PricingModel = 'tiered' | 'volume';

function validateTiers(tiers: PricingTier[]): void {
  if (tiers.length === 0) throw new UsageBillingError('At least one tier required');
  for (let i = 0; i < tiers.length; i++) {
    const isFinal = i === tiers.length - 1;
    const u = tiers[i]!.upTo;
    if (!isFinal && u === null) {
      throw new UsageBillingError('Only the final tier may be unbounded');
    }
    if (i > 0) {
      const prev = tiers[i - 1]!.upTo;
      // a non-final bound must strictly exceed the previous bound
      if (prev !== null && u !== null && u <= prev) {
        throw new UsageBillingError('Tier bounds must strictly increase');
      }
    }
  }
}

/**
 * Tiered pricing: each unit is charged at the price of the tier its position falls into
 * (graduated). e.g. first 100 @ £1, next 900 @ £0.50, rest @ £0.25.
 */
export function tieredCharge(units: number, tiers: PricingTier[]): Money {
  if (units < 0) throw new UsageBillingError('units must be >= 0');
  validateTiers(tiers);
  const currency = tiers[0]!.unitPrice.currency;
  let remaining = units;
  let prevBound = 0;
  let total = money(0, currency);
  for (const tier of tiers) {
    if (remaining <= 0) break;
    const cap = tier.upTo === null ? Infinity : tier.upTo - prevBound;
    const inThisTier = Math.min(remaining, cap);
    total = add(total, multiplyByQuantity(tier.unitPrice, inThisTier));
    remaining -= inThisTier;
    prevBound = tier.upTo ?? prevBound;
  }
  if (remaining > 0) throw new UsageBillingError('Usage exceeds defined tiers (no unbounded final tier)');
  return total;
}

/**
 * Volume pricing: ALL units are charged at the single tier the total volume lands in.
 * e.g. 1500 units total -> every unit at the 1000+ tier price.
 */
export function volumeCharge(units: number, tiers: PricingTier[]): Money {
  if (units < 0) throw new UsageBillingError('units must be >= 0');
  validateTiers(tiers);
  let chosen = tiers[tiers.length - 1]!;
  let prevBound = 0;
  for (const tier of tiers) {
    const upper = tier.upTo === null ? Infinity : tier.upTo;
    if (units <= upper && units > prevBound) { chosen = tier; break; }
    // units exactly at lower boundary handled by next tier; track bound
    if (tier.upTo !== null) prevBound = tier.upTo;
  }
  // edge: zero units lands in first tier
  if (units === 0) chosen = tiers[0]!;
  return multiplyByQuantity(chosen.unitPrice, units);
}

export function computeUsageCharge(units: number, model: PricingModel, tiers: PricingTier[]): Money {
  return model === 'tiered' ? tieredCharge(units, tiers) : volumeCharge(units, tiers);
}

/* ───────────────────────── Commitments & true-ups ───────────────────────── */

export interface Commitment {
  readonly committedUnits: number;
  readonly committedAmount: Money; // prepaid
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface TrueUp {
  readonly actualUnits: number;
  readonly committedUnits: number;
  readonly overageUnits: number;
  readonly overageCharge: Money;   // charge for usage beyond commitment
  readonly shortfall: number;      // committed-but-unused units (use-it-or-lose-it)
  readonly totalDue: Money;        // commitment already prepaid; this is incremental overage
}

/**
 * True-up against a commitment: if actual usage exceeds the committed units, the excess is
 * charged at the overage tiers; if below, the unused commitment is a shortfall (already paid).
 */
export function trueUp(
  commitment: Commitment, actualUnits: number, model: PricingModel, overageTiers: PricingTier[],
): TrueUp {
  if (actualUnits < 0) throw new UsageBillingError('actualUnits must be >= 0');
  const currency = commitment.committedAmount.currency;
  if (actualUnits > commitment.committedUnits) {
    const overageUnits = actualUnits - commitment.committedUnits;
    const overageCharge = computeUsageCharge(overageUnits, model, overageTiers);
    return {
      actualUnits, committedUnits: commitment.committedUnits, overageUnits,
      overageCharge, shortfall: 0, totalDue: overageCharge,
    };
  }
  return {
    actualUnits, committedUnits: commitment.committedUnits, overageUnits: 0,
    overageCharge: money(0, currency),
    shortfall: commitment.committedUnits - actualUnits,
    totalDue: money(0, currency),
  };
}

/* ───────────────────────── Burst / peak overage ───────────────────────── */

export interface BurstPolicy {
  readonly includedPeak: number;   // included peak capacity
  readonly burstUnitPrice: Money;  // price per unit of peak above included
}

/** Charge for exceeding included peak capacity (e.g. concurrent connections, throughput). */
export function burstCharge(observedPeak: number, policy: BurstPolicy): Money {
  if (observedPeak < 0) throw new UsageBillingError('observedPeak must be >= 0');
  const over = Math.max(0, observedPeak - policy.includedPeak);
  return multiplyByQuantity(policy.burstUnitPrice, over);
}

/**
 * Total expected consumption charge = base usage + true-up overage + burst.
 * Used by reconciliation to compare against what was actually invoiced.
 */
export function expectedConsumption(
  baseUsage: Money, trueUpDue: Money, burst: Money,
): Money {
  return add(add(baseUsage, trueUpDue), burst);
}

/** Detect consumption under-billing: expected minus actually invoiced (0 if fully billed). */
export function consumptionLeakage(expected: Money, invoiced: Money): Money {
  const diff = subtract(expected, invoiced);
  return compare(diff, money(0, diff.currency)) > 0 ? diff : money(0, diff.currency);
}

/** A discount on committed spend (e.g. 10% off prepaid commitments). */
export function commitmentDiscount(committed: Money, percent: number): Money {
  const reduction = applyPercentage(committed, percent);
  return subtract(committed, reduction);
}
