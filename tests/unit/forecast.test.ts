import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ForecastError, leakageRunRate, confidenceBand, projectRecovery,
  scoreRenewalRisk, rankRenewalRisks, totalAtRisk, type RenewalRisk,
} from '../../src/forecasting/forecast.ts';
import { money } from '../../src/money/money.ts';
import type { LeakageCase, Contract, ContractTerm, Renewal } from '../../src/core/model.ts';

function caseOf(id: string, status: LeakageCase['status'], net: number): LeakageCase {
  return { id, customerId: 'c', status, createdAt: '2026-01-01', findings: [{ id: `${id}-f`, type: 'intent', netRecoverable: money(net, 'GBP') }] };
}

test('leakageRunRate annualizes linearly', () => {
  const rr = leakageRunRate(money(3650_00, 'GBP'), 10);
  assert.equal(rr.isForecast, true);
  assert.equal(rr.perDay.amount, 36500);
  assert.equal(rr.per30Days.amount, 36500 * 30);
  assert.equal(rr.annualized.amount, 36500 * 365);
  assert.equal(rr.basisDays, 10);
});

test('leakageRunRate rejects non-positive window', () => {
  assert.throws(() => leakageRunRate(money(100, 'GBP'), 0), ForecastError);
});

test('confidenceBand builds a symmetric band', () => {
  const b = confidenceBand(money(1000_00, 'GBP'), 0.15);
  assert.equal(b.mid.amount, 1000_00);
  assert.equal(b.low.amount, 85000);
  assert.equal(b.high.amount, 115000);
});

test('confidenceBand validates spread', () => {
  assert.throws(() => confidenceBand(money(100, 'GBP'), -0.1), ForecastError);
  assert.throws(() => confidenceBand(money(100, 'GBP'), 1.1), ForecastError);
});

test('projectRecovery sums only open/escalated/in_dispute cases', () => {
  const cases = [
    caseOf('a', 'open', 100_00),
    caseOf('b', 'escalated', 200_00),
    caseOf('c', 'in_dispute', 50_00),
    caseOf('d', 'recovered', 999_00), // excluded
    caseOf('e', 'rejected', 999_00),  // excluded
  ];
  const p = projectRecovery(cases, 'GBP', 0.5);
  assert.equal(p.openRecoverable.amount, 350_00);
  assert.equal(p.expectedRecovered.amount, 175_00);
  assert.equal(p.band.mid.amount, 175_00);
});

test('projectRecovery validates historicalRate', () => {
  assert.throws(() => projectRecovery([], 'GBP', 1.5), ForecastError);
});

function term(over: Partial<ContractTerm> = {}): ContractTerm {
  return { id: 't', contractId: 'k', product: 'P', unitPrice: money(1000_00, 'GBP'), quantity: 2, billingPeriod: 'monthly', escalatorPercent: 0, ...over };
}
const contract: Contract = { id: 'k', customerId: 'cust', startDate: 'a', endDate: 'b', machineReadable: true };
function renewal(escalatorApplied: boolean): Renewal {
  return { id: 'r', contractId: 'k', currentEndDate: '2026-12-31', escalatorApplied };
}

test('scoreRenewalRisk: near + unhealthy + no escalator = high risk', () => {
  const r = scoreRenewalRisk(term(), contract, renewal(false), 10, 0.2);
  // proximity 1, health component 0.8, escalator 0.2 -> 0.5 + 0.32 + 0.2 = 1.02 -> capped 1
  assert.equal(r.riskScore, 1);
  assert.equal(r.annualValue.amount, 1000_00 * 2 * 12);
  assert.equal(r.atRiskValue.amount, r.annualValue.amount);
});

test('scoreRenewalRisk: far + healthy + escalator applied = low risk', () => {
  const r = scoreRenewalRisk(term({ billingPeriod: 'annual' }), contract, renewal(true), 200, 1);
  // proximity 0, health 0, escalator 0 -> 0
  assert.equal(r.riskScore, 0);
  assert.equal(r.annualValue.amount, 1000_00 * 2); // annual term not ×12
});

test('scoreRenewalRisk mid-proximity interpolates', () => {
  const r = scoreRenewalRisk(term(), contract, renewal(true), 105, 1);
  // proximity (180-105)/150 = 0.5 -> risk 0.25
  assert.equal(r.riskScore, 0.25);
});

test('scoreRenewalRisk validates health and daysToRenewal', () => {
  assert.throws(() => scoreRenewalRisk(term(), contract, renewal(true), 10, 1.5), ForecastError);
  assert.throws(() => scoreRenewalRisk(term(), contract, renewal(true), -1, 0.5), ForecastError);
});

test('rankRenewalRisks orders by at-risk value desc; totalAtRisk sums', () => {
  const risks: RenewalRisk[] = [
    { contractId: 'a', customerId: 'c', annualValue: money(100, 'GBP'), daysToRenewal: 10, riskScore: 0.5, atRiskValue: money(50, 'GBP') },
    { contractId: 'b', customerId: 'c', annualValue: money(100, 'GBP'), daysToRenewal: 10, riskScore: 0.9, atRiskValue: money(90, 'GBP') },
  ];
  assert.deepEqual(rankRenewalRisks(risks).map((r) => r.contractId), ['b', 'a']);
  assert.equal(totalAtRisk(risks, 'GBP').amount, 140);
});
