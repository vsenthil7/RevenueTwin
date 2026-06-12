/**
 * Tax & jurisdiction engine (S35).
 *
 * Determines tax across jurisdictions with support for multiple simultaneous rates (e.g. state +
 * city), compound tax (tax-on-tax), and exemptions. Deterministic integer money; under-applied or
 * mis-applied tax becomes a detectable variance for the recon core.
 */
import { money, add, applyPercentage, type Money } from '../money/money.ts';

export class TaxError extends Error {
  constructor(message: string) { super(message); this.name = 'TaxError'; }
}

export interface TaxComponent {
  readonly jurisdiction: string;
  readonly name: string;        // e.g. 'VAT', 'State Sales Tax', 'City Tax'
  readonly ratePercent: number;
  /** compound: applied on (base + previously accumulated tax) rather than base alone. */
  readonly compound: boolean;
}

export interface TaxLine {
  readonly component: TaxComponent;
  readonly taxable: Money;  // the base this component was applied to
  readonly tax: Money;
}

export interface TaxAssessment {
  readonly base: Money;
  readonly lines: TaxLine[];
  readonly totalTax: Money;
  readonly gross: Money;
  readonly exempt: boolean;
}

/**
 * Assess tax for a base amount across ordered components. Non-compound components apply to the
 * original base; compound components apply to base + accumulated tax so far. Order matters and is
 * preserved. Exempt = no tax.
 */
export function assessTax(base: Money, components: TaxComponent[], exempt = false): TaxAssessment {
  if (base.amount < 0) throw new TaxError('base must be >= 0');
  if (exempt) {
    return { base, lines: [], totalTax: money(0, base.currency), gross: base, exempt: true };
  }
  const lines: TaxLine[] = [];
  let accumulatedTax = money(0, base.currency);
  for (const c of components) {
    if (c.ratePercent < 0) throw new TaxError(`Negative rate for ${c.name}`);
    const taxable = c.compound ? add(base, accumulatedTax) : base;
    const tax = applyPercentage(taxable, c.ratePercent);
    lines.push({ component: c, taxable, tax });
    accumulatedTax = add(accumulatedTax, tax);
  }
  return {
    base, lines, totalTax: accumulatedTax,
    gross: add(base, accumulatedTax), exempt: false,
  };
}

/** Effective tax rate (totalTax / base) as a percentage. */
export function effectiveRate(assessment: TaxAssessment): number {
  if (assessment.base.amount === 0) return 0;
  return Math.round((assessment.totalTax.amount / assessment.base.amount) * 10000) / 100;
}

/* ───────────────────────── Jurisdiction resolution ───────────────────────── */

export interface JurisdictionRule {
  readonly country: string;
  readonly region?: string; // state/province
  readonly components: TaxComponent[];
}

/** Resolve the tax components for a (country, region) pair. Most specific match wins. */
export class JurisdictionRegistry {
  private rules: JurisdictionRule[] = [];

  register(rule: JurisdictionRule): void {
    this.rules.push(rule);
  }

  resolve(country: string, region?: string): TaxComponent[] {
    // prefer an exact country+region match
    if (region !== undefined) {
      const exact = this.rules.find((r) => r.country === country && r.region === region);
      if (exact) return exact.components;
    }
    // fall back to a country-level rule (no region)
    const countryLevel = this.rules.find((r) => r.country === country && r.region === undefined);
    if (countryLevel) return countryLevel.components;
    throw new TaxError(`No jurisdiction rule for ${country}${region ? '/' + region : ''}`);
  }

  /** Assess tax by resolving the jurisdiction first. */
  assess(base: Money, country: string, region?: string, exempt = false): TaxAssessment {
    return assessTax(base, this.resolve(country, region), exempt);
  }
}

/** Detect tax leakage: expected tax (per jurisdiction) minus what was actually charged. */
export function taxLeakage(expected: TaxAssessment, actuallyCharged: Money): Money {
  const diff = expected.totalTax.amount - actuallyCharged.amount;
  return diff > 0 ? money(diff, expected.totalTax.currency) : money(0, expected.totalTax.currency);
}
