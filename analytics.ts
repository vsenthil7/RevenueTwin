/**
 * Reporting & CFO analytics (S19).
 *
 * Aggregates leakage cases into the figures a CFO and board actually want: total recoverable,
 * recovered to date, recovery rate, leakage broken down by type, recovered-over-time series,
 * and a period-close evidence pack. All money stays in integer minor units via the money engine.
 */
import { money, add, type Money } from '../money/money.ts';
import type { LeakageCase, LeakageType, CaseStatus } from '../core/model.ts';

export class ReportError extends Error {
  constructor(message: string) { super(message); this.name = 'ReportError'; }
}

/** Sum the net-recoverable across a case's findings (single currency assumed per portfolio). */
export function caseNet(c: LeakageCase, currency: string): Money {
  return c.findings.reduce<Money>((acc, f) => add(acc, f.netRecoverable), money(0, currency));
}

const RECOVERED_STATUSES: CaseStatus[] = ['recovered', 'partially_recovered'];

export interface PortfolioSummary {
  totalCases: number;
  totalRecoverable: Money;
  recoveredToDate: Money;
  recoveryRatePct: number; // recovered / recoverable * 100, 0 when no recoverable
  workIQAttributable: Money; // recoverable attributable to Work IQ-detected cases
}

export function portfolioSummary(cases: LeakageCase[], currency: string): PortfolioSummary {
  let totalRecoverable = money(0, currency);
  let recovered = money(0, currency);
  let workIQ = money(0, currency);
  for (const c of cases) {
    const net = caseNet(c, currency);
    totalRecoverable = add(totalRecoverable, net);
    if (RECOVERED_STATUSES.includes(c.status)) recovered = add(recovered, net);
    if (c.detectedViaWorkIQ) workIQ = add(workIQ, net);
  }
  const rate = totalRecoverable.amount === 0 ? 0 : (recovered.amount / totalRecoverable.amount) * 100;
  return {
    totalCases: cases.length,
    totalRecoverable,
    recoveredToDate: recovered,
    recoveryRatePct: Math.round(rate * 100) / 100,
    workIQAttributable: workIQ,
  };
}

/** Leakage broken down by type, ranked by recoverable descending. */
export interface LeakageByType { type: LeakageType; cases: number; recoverable: Money; }

export function leakageByType(cases: LeakageCase[], currency: string): LeakageByType[] {
  const map = new Map<LeakageType, { cases: number; recoverable: Money }>();
  for (const c of cases) {
    for (const f of c.findings) {
      const cur = map.get(f.type) ?? { cases: 0, recoverable: money(0, currency) };
      cur.cases += 1;
      cur.recoverable = add(cur.recoverable, f.netRecoverable);
      map.set(f.type, cur);
    }
  }
  return [...map.entries()]
    .map(([type, v]) => ({ type, cases: v.cases, recoverable: v.recoverable }))
    .sort((a, b) => b.recoverable.amount - a.recoverable.amount);
}

/** Recovered amount per calendar period (YYYY-MM), based on case createdAt, recovered statuses. */
export interface PeriodPoint { period: string; recovered: Money; }

export function recoveredOverTime(cases: LeakageCase[], currency: string): PeriodPoint[] {
  const map = new Map<string, Money>();
  for (const c of cases) {
    if (!RECOVERED_STATUSES.includes(c.status)) continue;
    const period = c.createdAt.slice(0, 7); // YYYY-MM
    if (period.length !== 7) throw new ReportError(`Bad createdAt on case ${c.id}`);
    const cur = map.get(period) ?? money(0, currency);
    map.set(period, add(cur, caseNet(c, currency)));
  }
  return [...map.entries()]
    .map(([period, recovered]) => ({ period, recovered }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

/** Board/audit period-close pack combining the above for a date range. */
export interface PeriodClosePack {
  from: string;
  to: string;
  summary: PortfolioSummary;
  byType: LeakageByType[];
  timeline: PeriodPoint[];
  caseIds: string[];
}

export function periodClosePack(cases: LeakageCase[], currency: string, from: string, to: string): PeriodClosePack {
  const f = Date.parse(from), t = Date.parse(to);
  if (Number.isNaN(f) || Number.isNaN(t)) throw new ReportError('Invalid period bounds');
  if (f > t) throw new ReportError('Period from is after to');
  const inRange = cases.filter((c) => {
    const at = Date.parse(c.createdAt);
    return at >= f && at <= t;
  });
  return {
    from, to,
    summary: portfolioSummary(inRange, currency),
    byType: leakageByType(inRange, currency),
    timeline: recoveredOverTime(inRange, currency),
    caseIds: inRange.map((c) => c.id),
  };
}
