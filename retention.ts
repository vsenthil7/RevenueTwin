/**
 * Churn & expansion modeling (S39).
 *
 * Net/Gross revenue retention and the expansion/contraction/churn decomposition that underpins
 * SaaS valuation — and reveals expansion that was agreed but never billed (a leakage signal).
 * Deterministic; money in integer minor units.
 */
import { money, add, subtract, toDecimal, type Money } from '../money/money.ts';

export class ChurnError extends Error {
  constructor(message: string) { super(message); this.name = 'ChurnError'; }
}

export interface CustomerRevenue {
  readonly customerId: string;
  readonly startArr: Money; // ARR at period start
  readonly endArr: Money;   // ARR at period end (0 = churned)
}

export interface RetentionDecomposition {
  readonly startingArr: Money;
  readonly expansion: Money;     // increases among retained customers
  readonly contraction: Money;   // decreases among retained customers (positive magnitude)
  readonly churn: Money;         // ARR lost to full churn (positive magnitude)
  readonly endingArrFromBase: Money; // ending ARR from the starting cohort (excludes new logos)
  readonly grr: number;          // gross revenue retention (0..1+, capped logic below)
  readonly nrr: number;          // net revenue retention
}

function assertCurrency(cohort: CustomerRevenue[], currency: string): void {
  for (const c of cohort) {
    if (c.startArr.currency !== currency || c.endArr.currency !== currency) {
      throw new ChurnError('All ARR values must share one currency');
    }
  }
}

/**
 * Decompose a starting cohort's revenue movement. New logos are excluded (NRR/GRR are about the
 * existing base). Expansion/contraction are within retained accounts; churn is fully lost accounts.
 */
export function decomposeRetention(cohort: CustomerRevenue[], currency: string): RetentionDecomposition {
  assertCurrency(cohort, currency);
  let starting = money(0, currency);
  let expansion = money(0, currency);
  let contraction = money(0, currency);
  let churn = money(0, currency);

  for (const c of cohort) {
    starting = add(starting, c.startArr);
    if (c.endArr.amount === 0) {
      churn = add(churn, c.startArr); // full churn
      continue;
    }
    const delta = c.endArr.amount - c.startArr.amount;
    if (delta > 0) expansion = add(expansion, money(delta, currency));
    else if (delta < 0) contraction = add(contraction, money(-delta, currency));
  }

  const endingFromBase = subtract(add(starting, expansion), add(contraction, churn));
  const startMajor = toDecimal(starting);
  const grr = startMajor === 0 ? 0
    : toDecimal(subtract(starting, add(contraction, churn))) / startMajor;
  const nrr = startMajor === 0 ? 0 : toDecimal(endingFromBase) / startMajor;

  return {
    startingArr: starting, expansion, contraction, churn,
    endingArrFromBase: endingFromBase,
    grr: Math.round(grr * 10000) / 10000,
    nrr: Math.round(nrr * 10000) / 10000,
  };
}

/** Logo churn rate: fraction of customers fully churned. */
export function logoChurnRate(cohort: CustomerRevenue[]): number {
  if (cohort.length === 0) return 0;
  const churned = cohort.filter((c) => c.endArr.amount === 0).length;
  return Math.round((churned / cohort.length) * 10000) / 10000;
}

/**
 * Expansion-billing gap: agreed expansion (e.g. from Work IQ / amendments) that isn't reflected
 * in the period's ending ARR — expansion revenue left on the table.
 */
export function expansionBillingGap(agreedExpansion: Money, observedExpansion: Money): Money {
  const diff = subtract(agreedExpansion, observedExpansion);
  return diff.amount > 0 ? diff : money(0, agreedExpansion.currency);
}

/** Quick-ratio-style health: (expansion) / (contraction + churn). Higher is healthier. */
export function revenueQuickRatio(d: RetentionDecomposition): number {
  const downside = d.contraction.amount + d.churn.amount;
  if (downside === 0) return d.expansion.amount === 0 ? 0 : Infinity;
  return Math.round((d.expansion.amount / downside) * 100) / 100;
}
