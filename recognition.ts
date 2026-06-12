/**
 * Revenue recognition (S37) — ASC 606 / IFRS 15.
 *
 * Schedules recognition of a transaction price across performance obligations: ratable over time
 * (straight-line) or at a point in time. Produces a period-by-period recognition schedule and a
 * deferred-revenue waterfall. Deterministic, integer minor units; remainders distributed so the
 * schedule sums exactly to the obligation amount.
 */
import { money, add, subtract, type Money } from '../money/money.ts';

export class RevRecError extends Error {
  constructor(message: string) { super(message); this.name = 'RevRecError'; }
}

export type RecognitionMethod = 'ratable' | 'point_in_time';

export interface PerformanceObligation {
  readonly id: string;
  readonly amount: Money;            // allocated transaction price
  readonly method: RecognitionMethod;
  readonly startPeriod: number;      // 0-based period index
  readonly periods: number;          // number of periods over which to recognize (>=1)
  /** for point_in_time: the period in which control transfers (relative to startPeriod). */
  readonly pointPeriodOffset?: number;
}

export interface RecognitionEntry {
  readonly obligationId: string;
  readonly period: number;
  readonly recognized: Money;
}

/** Straight-line split of an amount over n periods with remainder distributed to earliest periods. */
export function straightLine(amount: Money, periods: number): Money[] {
  if (periods < 1) throw new RevRecError('periods must be >= 1');
  const base = Math.trunc(amount.amount / periods);
  let remainder = amount.amount - base * periods;
  const sign = remainder >= 0 ? 1 : -1;
  remainder = Math.abs(remainder);
  const out: Money[] = [];
  for (let i = 0; i < periods; i++) {
    let amt = base;
    if (remainder > 0) { amt += sign; remainder -= 1; }
    out.push({ amount: amt, currency: amount.currency });
  }
  return out;
}

/** Build the recognition schedule for a single obligation. */
export function recognizeObligation(po: PerformanceObligation): RecognitionEntry[] {
  if (po.periods < 1) throw new RevRecError('periods must be >= 1');
  if (po.method === 'point_in_time') {
    const offset = po.pointPeriodOffset ?? 0;
    if (offset < 0 || offset >= po.periods) {
      throw new RevRecError('pointPeriodOffset must be within [0, periods)');
    }
    return [{ obligationId: po.id, period: po.startPeriod + offset, recognized: po.amount }];
  }
  // ratable
  const slices = straightLine(po.amount, po.periods);
  return slices.map((recognized, i) => ({ obligationId: po.id, period: po.startPeriod + i, recognized }));
}

/** Combine schedules for many obligations into one. */
export function recognizeAll(obligations: PerformanceObligation[]): RecognitionEntry[] {
  return obligations.flatMap((po) => recognizeObligation(po));
}

/** Total recognized in a given period across a schedule. */
export function recognizedInPeriod(schedule: RecognitionEntry[], period: number, currency: string): Money {
  return schedule
    .filter((e) => e.period === period)
    .reduce<Money>((acc, e) => add(acc, e.recognized), money(0, currency));
}

/** Cumulative recognized up to and including a period. */
export function cumulativeRecognized(schedule: RecognitionEntry[], throughPeriod: number, currency: string): Money {
  return schedule
    .filter((e) => e.period <= throughPeriod)
    .reduce<Money>((acc, e) => add(acc, e.recognized), money(0, currency));
}

export interface WaterfallRow { period: number; recognized: Money; deferredRemaining: Money; }

/**
 * Deferred-revenue waterfall: for each period from 0..maxPeriod, the amount recognized and the
 * deferred balance remaining (total billed minus cumulative recognized).
 */
export function deferredWaterfall(
  schedule: RecognitionEntry[], totalBilled: Money, maxPeriod: number,
): WaterfallRow[] {
  if (maxPeriod < 0) throw new RevRecError('maxPeriod must be >= 0');
  const rows: WaterfallRow[] = [];
  for (let p = 0; p <= maxPeriod; p++) {
    const recognized = recognizedInPeriod(schedule, p, totalBilled.currency);
    const cumulative = cumulativeRecognized(schedule, p, totalBilled.currency);
    rows.push({ period: p, recognized, deferredRemaining: subtract(totalBilled, cumulative) });
  }
  return rows;
}

/**
 * Recognition leakage: revenue that should have been recognized through a period but wasn't
 * (e.g. a delivered obligation not booked). expected = scheduled cumulative; actual = booked.
 */
export function recognitionVariance(
  schedule: RecognitionEntry[], throughPeriod: number, actualRecognized: Money,
): Money {
  const expected = cumulativeRecognized(schedule, throughPeriod, actualRecognized.currency);
  const diff = subtract(expected, actualRecognized);
  return diff.amount > 0 ? diff : money(0, actualRecognized.currency);
}
