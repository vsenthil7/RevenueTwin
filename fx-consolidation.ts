/**
 * Multi-currency consolidation (S21).
 *
 * Global enterprises hold leakage across many currencies. This module consolidates amounts into
 * a single reporting currency using as-of-date FX, with an auditable rate book. It never mixes
 * currencies implicitly: every cross-currency sum goes through an explicit, dated conversion.
 */
import { money, add, convertFx, toDecimal, type Money, type FxRate, type CurrencyCode } from '../money/money.ts';

export class ConsolidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ConsolidationError'; }
}

/** A rate book of FX rates keyed by from→to→asOf. The single source of dated rates. */
export class FxRateBook {
  private rates = new Map<string, FxRate>();

  private key(from: CurrencyCode, to: CurrencyCode, asOf: string): string {
    return `${from}|${to}|${asOf}`;
  }

  add(rate: FxRate): void {
    if (rate.rate <= 0) throw new ConsolidationError(`Rate must be > 0 for ${rate.from}->${rate.to}`);
    this.rates.set(this.key(rate.from, rate.to, rate.asOf), rate);
  }

  /** Resolve a rate; identity (same currency) returns rate 1. Throws when missing. */
  resolve(from: CurrencyCode, to: CurrencyCode, asOf: string): FxRate {
    if (from === to) return { from, to, rate: 1, asOf };
    const direct = this.rates.get(this.key(from, to, asOf));
    if (direct) return direct;
    // try inverse
    const inverse = this.rates.get(this.key(to, from, asOf));
    if (inverse) return { from, to, rate: 1 / inverse.rate, asOf };
    throw new ConsolidationError(`No FX rate ${from}->${to} as-of ${asOf}`);
  }

  has(from: CurrencyCode, to: CurrencyCode, asOf: string): boolean {
    return from === to
      || this.rates.has(this.key(from, to, asOf))
      || this.rates.has(this.key(to, from, asOf));
  }
}

/** Convert any Money into the reporting currency as-of a date, using the rate book. */
export function toReporting(m: Money, reporting: CurrencyCode, book: FxRateBook, asOf: string): Money {
  if (m.currency === reporting) return m;
  const rate = book.resolve(m.currency, reporting, asOf);
  return convertFx(m, rate, asOf);
}

export interface ConsolidationLine {
  readonly original: Money;
  readonly converted: Money;
  readonly rateUsed: number;
}

export interface ConsolidatedTotal {
  readonly reporting: CurrencyCode;
  readonly asOf: string;
  readonly total: Money;
  readonly lines: ConsolidationLine[];
  readonly currencyBreakdown: { currency: CurrencyCode; original: Money; converted: Money }[];
}

/**
 * Consolidate a set of Money amounts (possibly mixed currencies) into one reporting total,
 * with a per-line audit trail and a per-currency breakdown.
 */
export function consolidate(
  amounts: Money[], reporting: CurrencyCode, book: FxRateBook, asOf: string,
): ConsolidatedTotal {
  const lines: ConsolidationLine[] = [];
  const byCurrency = new Map<CurrencyCode, { original: Money; converted: Money }>();
  let total = money(0, reporting);

  for (const m of amounts) {
    const rate = m.currency === reporting ? { rate: 1 } as FxRate : book.resolve(m.currency, reporting, asOf);
    const converted = toReporting(m, reporting, book, asOf);
    lines.push({ original: m, converted, rateUsed: rate.rate });
    total = add(total, converted);

    const cur = byCurrency.get(m.currency) ?? { original: money(0, m.currency), converted: money(0, reporting) };
    cur.original = add(cur.original, m);
    cur.converted = add(cur.converted, converted);
    byCurrency.set(m.currency, cur);
  }

  const currencyBreakdown = [...byCurrency.entries()]
    .map(([currency, v]) => ({ currency, original: v.original, converted: v.converted }))
    .sort((a, b) => b.converted.amount - a.converted.amount);

  return { reporting, asOf, total, lines, currencyBreakdown };
}

/** Exposure concentration: share of consolidated total contributed by each currency (0..1). */
export function currencyConcentration(c: ConsolidatedTotal): { currency: CurrencyCode; share: number }[] {
  const totalMajor = toDecimal(c.total);
  return c.currencyBreakdown.map((b) => ({
    currency: b.currency,
    share: totalMajor === 0 ? 0 : toDecimal(b.converted) / totalMajor,
  }));
}
