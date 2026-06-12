/**
 * Contract lifecycle (S36).
 *
 * Models the real shapes enterprise contracts take: ramp deals (escalating value over periods),
 * co-terming (aligning multiple contracts to one end date), and mid-term changes. Produces the
 * expected period-by-period values the recon core checks billing against. Integer money.
 */
import { money, add, applyPercentage, multiplyByQuantity, type Money } from '../money/money.ts';

export class LifecycleError extends Error {
  constructor(message: string) { super(message); this.name = 'LifecycleError'; }
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(a), db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) throw new LifecycleError('Invalid date');
  return Math.round((db - da) / 86_400_000);
}

/* ───────────────────────── Ramp deals ───────────────────────── */

export interface RampPeriod {
  readonly periodIndex: number;
  readonly months: number;
  readonly monthlyValue: Money;
}

/**
 * Build a ramp schedule: a base monthly value escalating by a percentage each ramp period.
 * e.g. £10k/mo for 12mo, then +20% for next 12, then +20% again.
 */
export function buildRamp(baseMonthly: Money, periodMonths: number[], escalatorPercent: number): RampPeriod[] {
  if (periodMonths.length === 0) throw new LifecycleError('At least one ramp period required');
  if (periodMonths.some((m) => m <= 0)) throw new LifecycleError('Ramp period months must be > 0');
  const periods: RampPeriod[] = [];
  let current = baseMonthly;
  periodMonths.forEach((months, i) => {
    if (i > 0) current = add(current, applyPercentage(current, escalatorPercent));
    periods.push({ periodIndex: i, months, monthlyValue: current });
  });
  return periods;
}

/** Total contract value across a ramp schedule. */
export function rampTotalValue(ramp: RampPeriod[]): Money {
  if (ramp.length === 0) throw new LifecycleError('Empty ramp');
  return ramp.reduce<Money>(
    (acc, p) => add(acc, multiplyByQuantity(p.monthlyValue, p.months)),
    money(0, ramp[0]!.monthlyValue.currency),
  );
}

/** Expected value for a specific month index across the ramp (0-based). */
export function rampValueAtMonth(ramp: RampPeriod[], monthIndex: number): Money {
  if (monthIndex < 0) throw new LifecycleError('monthIndex must be >= 0');
  let elapsed = 0;
  for (const p of ramp) {
    if (monthIndex < elapsed + p.months) return p.monthlyValue;
    elapsed += p.months;
  }
  throw new LifecycleError(`monthIndex ${monthIndex} beyond ramp length`);
}

/* ───────────────────────── Co-terming ───────────────────────── */

export interface CoTermInput {
  readonly contractId: string;
  readonly monthlyValue: Money;
  readonly currentEndDate: string;
}

export interface CoTermResult {
  readonly contractId: string;
  readonly alignedEndDate: string;
  readonly proratedAdjustment: Money; // value of extending/shortening to the aligned date
  readonly extraDays: number;
}

/**
 * Co-term multiple contracts to a single target end date. For each, computes the prorated value
 * adjustment for the day delta between its current end and the target (positive = extension).
 */
export function coTerm(contracts: CoTermInput[], targetEndDate: string): CoTermResult[] {
  return contracts.map((c) => {
    const extraDays = daysBetween(c.currentEndDate, targetEndDate);
    // prorate monthly value over a 30-day month for the delta
    const dailyMinor = Math.round(c.monthlyValue.amount / 30);
    const adjustment = money(dailyMinor * extraDays, c.monthlyValue.currency);
    return { contractId: c.contractId, alignedEndDate: targetEndDate, proratedAdjustment: adjustment, extraDays };
  });
}

/* ───────────────────────── Mid-term changes ───────────────────────── */

export interface MidTermChange {
  readonly effectiveDate: string;
  readonly newMonthlyValue: Money;
}

export interface ProratedPeriod {
  readonly from: string;
  readonly to: string;
  readonly value: Money;
}

/**
 * Split a billing period at a mid-term change date, prorating the old and new monthly values by
 * days on each side. Returns the two prorated sub-periods.
 */
export function applyMidTermChange(
  periodStart: string, periodEnd: string, oldMonthly: Money, change: MidTermChange,
): ProratedPeriod[] {
  const totalDays = daysBetween(periodStart, periodEnd);
  if (totalDays <= 0) throw new LifecycleError('period end must be after start');
  const changeDay = daysBetween(periodStart, change.effectiveDate);
  if (changeDay <= 0 || changeDay >= totalDays) {
    throw new LifecycleError('change effectiveDate must fall strictly within the period');
  }
  const oldDaily = oldMonthly.amount / 30;
  const newDaily = change.newMonthlyValue.amount / 30;
  const oldDays = changeDay;
  const newDays = totalDays - changeDay;
  return [
    { from: periodStart, to: change.effectiveDate, value: money(Math.round(oldDaily * oldDays), oldMonthly.currency) },
    { from: change.effectiveDate, to: periodEnd, value: money(Math.round(newDaily * newDays), change.newMonthlyValue.currency) },
  ];
}

/** Months remaining until a renewal date from a reference date (rounded down). */
export function monthsToRenewal(from: string, renewalDate: string): number {
  const days = daysBetween(from, renewalDate);
  return Math.max(0, Math.floor(days / 30));
}
