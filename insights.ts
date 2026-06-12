/**
 * Insights service (integration).
 *
 * Surfaces the domain modules over the live portfolio so the API and UI can show the product's
 * depth — not just a case list. Each method composes a deterministic domain module with the
 * persisted cases and returns a buyer-facing result. Read-only; no writes, no side effects.
 */
import { money, add, toDecimal, type Money } from '../money/money.ts';
import type { LeakageCase } from '../core/model.ts';
import { leakageRunRate, projectRecovery, type RecoveryProjection, type RunRate } from '../forecasting/forecast.ts';
import { benchmarkLeakage, recoveryMaturity, topQuartileUpside, type Industry, type BenchmarkResult } from '../benchmarking/peer-benchmark.ts';
import { buildEvidencePack, type EvidencePack, type ControlAttestation } from '../evidence/evidence-pack.ts';
import { detectAnomalies, moneySeries, type Anomaly } from '../anomaly/detection.ts';
import type { AuditEntry } from '../core/audit.ts';

export type { Industry } from '../benchmarking/peer-benchmark.ts';
export type { EvidencePack, ControlAttestation } from '../evidence/evidence-pack.ts';

function caseNet(c: LeakageCase, currency: string): Money {
  return c.findings.reduce<Money>((acc, f) => add(acc, f.netRecoverable), money(0, currency));
}

function totalNet(cases: LeakageCase[], currency: string): Money {
  return cases.reduce<Money>((acc, c) => add(acc, caseNet(c, currency)), money(0, currency));
}

/* ───────────────────────── ROI ───────────────────────── */

export interface RoiInputs {
  /** annual platform cost to the customer (minor units). */
  readonly annualPlatformCost: Money;
  /** analyst hours saved per month by automated detection. */
  readonly analystHoursSavedPerMonth: number;
  /** fully-loaded analyst cost per hour (minor units). */
  readonly analystHourlyCost: Money;
}

export interface RoiResult {
  readonly recoveredAnnualized: Money;   // detected recoverable, annualized from the window
  readonly laborSavingsAnnual: Money;
  readonly totalAnnualBenefit: Money;
  readonly annualCost: Money;
  readonly netAnnualValue: Money;
  readonly roiMultiple: number;          // benefit / cost
  readonly paybackMonths: number;        // cost / (benefit/12), capped
}

/**
 * Compute ROI from detected recoverable + labor savings vs. platform cost. Recoverable is
 * annualized from the observation window so a partial-period pilot extrapolates honestly.
 */
export function computeRoi(detectedRecoverable: Money, windowDays: number, inputs: RoiInputs): RoiResult {
  const rr = leakageRunRate(detectedRecoverable, windowDays);
  const recoveredAnnualized = rr.annualized;
  const laborSavingsAnnual = money(
    Math.round(inputs.analystHoursSavedPerMonth * 12 * inputs.analystHourlyCost.amount),
    detectedRecoverable.currency,
  );
  const totalAnnualBenefit = add(recoveredAnnualized, laborSavingsAnnual);
  const netAnnualValue = money(totalAnnualBenefit.amount - inputs.annualPlatformCost.amount, detectedRecoverable.currency);
  const roiMultiple = inputs.annualPlatformCost.amount === 0
    ? 0
    : Math.round((totalAnnualBenefit.amount / inputs.annualPlatformCost.amount) * 100) / 100;
  const monthlyBenefit = totalAnnualBenefit.amount / 12;
  const paybackMonths = monthlyBenefit <= 0
    ? Infinity
    : Math.round((inputs.annualPlatformCost.amount / monthlyBenefit) * 10) / 10;
  return {
    recoveredAnnualized, laborSavingsAnnual, totalAnnualBenefit,
    annualCost: inputs.annualPlatformCost, netAnnualValue, roiMultiple, paybackMonths,
  };
}

/* ───────────────────────── Insights over a portfolio ───────────────────────── */

export interface PortfolioInsights {
  readonly totalRecoverable: Money;
  readonly runRate: RunRate;
  readonly projection: RecoveryProjection;
  readonly benchmark: BenchmarkResult;
  readonly recoveryMaturity: ReturnType<typeof recoveryMaturity>;
  readonly topQuartileUpside: Money;
}

/**
 * Compute forward-looking insights over the portfolio: run-rate, projected recovery, peer
 * benchmark vs. an industry, recovery maturity, and the upside of reaching top quartile.
 */
export function portfolioInsights(
  cases: LeakageCase[], currency: string, opts: {
    windowDays: number; arr: Money; industry: Industry; historicalRecoveryRate: number;
  },
): PortfolioInsights {
  const total = totalNet(cases, currency);
  const runRate = leakageRunRate(total, opts.windowDays);
  const projection = projectRecovery(cases, currency, opts.historicalRecoveryRate);
  const benchmark = benchmarkLeakage(total, opts.arr, opts.industry);
  const recoveredCount = cases.filter((c) => c.status === 'recovered' || c.status === 'partially_recovered').length;
  const recRate = cases.length === 0 ? 0 : recoveredCount / cases.length;
  return {
    totalRecoverable: total,
    runRate,
    projection,
    benchmark,
    recoveryMaturity: recoveryMaturity(recRate),
    topQuartileUpside: topQuartileUpside(total, opts.arr, opts.industry),
  };
}

/** Anomaly scan over per-case recoverable amounts (flags outlier exposures). */
export function portfolioAnomalies(cases: LeakageCase[], currency: string): Anomaly[] {
  const points = cases.map((c) => ({ id: c.id, period: c.createdAt.slice(0, 7), amount: caseNet(c, currency) }));
  return detectAnomalies(moneySeries(points), 'mad', 3);
}

/** Build an evidence pack from the live portfolio + audit chain. */
export function evidenceFromPortfolio(args: {
  tenantId: string; from: string; to: string; generatedAt: string;
  cases: LeakageCase[]; audit: AuditEntry[]; controls: ControlAttestation[]; currency: string;
}): EvidencePack {
  return buildEvidencePack({
    tenantId: args.tenantId, periodFrom: args.from, periodTo: args.to, generatedAt: args.generatedAt,
    cases: args.cases, auditEntries: args.audit, controls: args.controls, currency: args.currency,
  });
}

/** Headline numbers for a dashboard hero strip. */
export interface Headline {
  readonly totalRecoverableMajor: number;
  readonly caseCount: number;
  readonly workIQShare: number; // 0..1 of recoverable attributable to Work IQ
  readonly currency: string;
}

export function headline(cases: LeakageCase[], currency: string): Headline {
  const total = totalNet(cases, currency);
  const workIQ = totalNet(cases.filter((c) => c.detectedViaWorkIQ), currency);
  const totalMajor = toDecimal(total);
  return {
    totalRecoverableMajor: totalMajor,
    caseCount: cases.length,
    workIQShare: total.amount === 0 ? 0 : Math.round((workIQ.amount / total.amount) * 100) / 100,
    currency,
  };
}
