/**
 * Forecasting & at-risk revenue (S22).
 *
 * Forward-looking views for the CFO: leakage run-rate, projected annual recovery, and a
 * renewal-at-risk pipeline. Every output is explicitly a FORECAST (isForecast: true) and carries
 * a confidence band — it is never presented as an actual. Deterministic given inputs.
 */
import { money, add, applyPercentage, multiplyByQuantity, type Money } from '../money/money.ts';
import type { LeakageCase, Contract, ContractTerm, Renewal } from '../core/model.ts';

export class ForecastError extends Error {
  constructor(message: string) { super(message); this.name = 'ForecastError'; }
}

function caseNet(c: LeakageCase, currency: string): Money {
  return c.findings.reduce<Money>((acc, f) => add(acc, f.netRecoverable), money(0, currency));
}

export interface RunRate {
  readonly isForecast: true;
  readonly perDay: Money;
  readonly per30Days: Money;
  readonly annualized: Money;
  readonly basisDays: number;
}

/**
 * Leakage run-rate from observed recoverable over a window. Linear annualization with the
 * detected total as the basis. Throws on a non-positive window.
 */
export function leakageRunRate(detectedTotal: Money, windowDays: number): RunRate {
  if (windowDays <= 0) throw new ForecastError('windowDays must be > 0');
  const perDayMinor = Math.round(detectedTotal.amount / windowDays);
  const perDay = money(perDayMinor, detectedTotal.currency);
  return {
    isForecast: true,
    perDay,
    per30Days: money(perDayMinor * 30, detectedTotal.currency),
    annualized: money(perDayMinor * 365, detectedTotal.currency),
    basisDays: windowDays,
  };
}

export interface ConfidenceBand { low: Money; mid: Money; high: Money; }

/** Build a symmetric confidence band around a mid value using a fractional spread (0..1). */
export function confidenceBand(mid: Money, spread: number): ConfidenceBand {
  if (spread < 0 || spread > 1) throw new ForecastError('spread must be in [0,1]');
  const lowPct = Math.round((1 - spread) * 100);
  const highPct = Math.round((1 + spread) * 100);
  return {
    low: applyPercentage(mid, lowPct),
    mid,
    high: applyPercentage(mid, highPct),
  };
}

export interface RecoveryProjection {
  readonly isForecast: true;
  readonly openRecoverable: Money;
  readonly expectedRecovered: Money; // openRecoverable * historicalRecoveryRate
  readonly band: ConfidenceBand;
}

/**
 * Project recovery from the current open pipeline given a historical recovery rate (0..1) and a
 * confidence spread. Open cases only; recovered/closed excluded.
 */
export function projectRecovery(
  cases: LeakageCase[], currency: string, historicalRate: number, spread = 0.15,
): RecoveryProjection {
  if (historicalRate < 0 || historicalRate > 1) throw new ForecastError('historicalRate must be in [0,1]');
  let open = money(0, currency);
  for (const c of cases) {
    if (c.status === 'open' || c.status === 'escalated' || c.status === 'in_dispute') {
      open = add(open, caseNet(c, currency));
    }
  }
  const expected = applyPercentage(open, Math.round(historicalRate * 100));
  return {
    isForecast: true,
    openRecoverable: open,
    expectedRecovered: expected,
    band: confidenceBand(expected, spread),
  };
}

/* ───────────────────────── Renewal-at-risk pipeline ───────────────────────── */

export interface RenewalRisk {
  readonly contractId: string;
  readonly customerId: string;
  readonly annualValue: Money;
  readonly daysToRenewal: number;
  readonly riskScore: number; // 0..1, higher = more at risk
  readonly atRiskValue: Money; // annualValue * riskScore
}

/**
 * Score a renewal's risk. Inputs: contract term, the renewal record, days until renewal, and a
 * health signal (0..1 where 1 = healthy). Risk rises as renewal nears and health drops; an
 * unapplied escalator adds risk (revenue left on the table).
 */
export function scoreRenewalRisk(
  term: ContractTerm, contract: Contract, renewal: Renewal, daysToRenewal: number, health: number,
): RenewalRisk {
  if (health < 0 || health > 1) throw new ForecastError('health must be in [0,1]');
  if (daysToRenewal < 0) throw new ForecastError('daysToRenewal must be >= 0');

  const periodValue = multiplyByQuantity(term.unitPrice, term.quantity);
  const annualValue = term.billingPeriod === 'monthly'
    ? multiplyByQuantity(periodValue, 12)
    : periodValue;

  // proximity component: <=30d -> 1.0, >=180d -> 0.0, linear between
  const proximity = daysToRenewal >= 180 ? 0 : daysToRenewal <= 30 ? 1 : (180 - daysToRenewal) / 150;
  const healthComponent = 1 - health;
  const escalatorComponent = renewal.escalatorApplied ? 0 : 0.2;

  let risk = 0.5 * proximity + 0.4 * healthComponent + escalatorComponent;
  if (risk > 1) risk = 1;
  const riskScore = Math.round(risk * 100) / 100;

  return {
    contractId: contract.id,
    customerId: contract.customerId,
    annualValue,
    daysToRenewal,
    riskScore,
    atRiskValue: applyPercentage(annualValue, Math.round(riskScore * 100)),
  };
}

/** Rank renewal risks by at-risk value descending (where to focus retention effort). */
export function rankRenewalRisks(risks: RenewalRisk[]): RenewalRisk[] {
  return [...risks].sort((a, b) => b.atRiskValue.amount - a.atRiskValue.amount);
}

/** Sum the total at-risk annual value across a pipeline. */
export function totalAtRisk(risks: RenewalRisk[], currency: string): Money {
  return risks.reduce<Money>((acc, r) => add(acc, r.atRiskValue), money(0, currency));
}
