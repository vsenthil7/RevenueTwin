/**
 * Money taxonomy (S47 — Block R foundation).
 *
 * The dependency the entire engine imports. Money is ALWAYS exact integer minor units
 * (pence/cents) — never a float — so reconciliation, allocation, FX and recognition are
 * bit-for-bit reproducible. The only place floats appear is at the display/ratio boundary
 * (`toDecimal`) and at the parse boundary (`fromDecimal`), both rounded deterministically.
 *
 * Invariants:
 *  - `Money.amount` is an integer (minor units). Constructors reject non-integers.
 *  - Arithmetic across mismatched currencies throws — no implicit conversion.
 *  - Percentages are expressed in *percent units* (100 = 100%, 12.5 = 12.5%).
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** ISO-4217-style currency code. Kept as a string alias so any tenant currency is allowed. */
export type CurrencyCode = string;

/** An exact monetary amount in integer minor units of a single currency. */
export interface Money {
  /** Integer minor units (e.g. pence). Never fractional. */
  readonly amount: number;
  readonly currency: CurrencyCode;
}

/** A directional FX rate, valid as of a date. `rate` multiplies a `from`-amount to get `to`. */
export interface FxRate {
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  /** Multiplier applied to the source major-unit value. Must be > 0. */
  readonly rate: number;
  /** ISO date the rate is valid as of (used by the rate book for as-of resolution). */
  readonly asOf: string;
}

function assertInteger(amount: number, context: string): void {
  if (!Number.isFinite(amount)) throw new MoneyError(`${context}: amount must be finite, got ${amount}`);
  if (!Number.isInteger(amount)) throw new MoneyError(`${context}: amount must be an integer (minor units), got ${amount}`);
}

function assertCurrency(currency: CurrencyCode): void {
  if (typeof currency !== 'string' || currency.length === 0) {
    throw new MoneyError(`Invalid currency code: ${String(currency)}`);
  }
}

/** Construct an exact Money value from integer minor units. */
export function money(amount: number, currency: CurrencyCode): Money {
  assertCurrency(currency);
  assertInteger(amount, 'money()');
  return { amount, currency };
}

function sameCurrency(a: Money, b: Money, op: string): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Cannot ${op} across currencies: ${a.currency} vs ${b.currency}`);
  }
}

/** Add two same-currency amounts. */
export function add(a: Money, b: Money): Money {
  sameCurrency(a, b, 'add');
  return { amount: a.amount + b.amount, currency: a.currency };
}

/** Subtract b from a (same currency). */
export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b, 'subtract');
  return { amount: a.amount - b.amount, currency: a.currency };
}

/**
 * Compare two same-currency amounts.
 * @returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b, 'compare');
  if (a.amount < b.amount) return -1;
  if (a.amount > b.amount) return 1;
  return 0;
}

/** True iff a and b are the same currency and amount. */
export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

/** True iff the amount is exactly zero (any currency). */
export function isZero(m: Money): boolean {
  return m.amount === 0;
}

/** Negate an amount (e.g. for a contraction or reversal). */
export function negate(m: Money): Money {
  return { amount: -m.amount, currency: m.currency };
}

/**
 * Apply a percentage to an amount, banker's-safe via half-away-from-zero rounding to whole
 * minor units. `percent` is in percent units: 100 ⇒ ×1.0, 12.5 ⇒ ×0.125.
 */
export function applyPercentage(m: Money, percent: number): Money {
  if (!Number.isFinite(percent)) throw new MoneyError(`applyPercentage: percent must be finite, got ${percent}`);
  const scaled = (m.amount * percent) / 100;
  return { amount: roundHalfAwayFromZero(scaled), currency: m.currency };
}

/** Multiply an amount by an integer quantity. Quantity must be a non-negative integer. */
export function multiplyByQuantity(m: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new MoneyError(`multiplyByQuantity: quantity must be a non-negative integer, got ${quantity}`);
  }
  return { amount: m.amount * quantity, currency: m.currency };
}

/**
 * Convert an amount using an FX rate, rounding to whole minor units. The rate's `from` must
 * match the amount's currency; the result is in the rate's `to` currency. `asOf` is accepted
 * for call-site symmetry with the rate book and is not otherwise used here.
 */
export function convertFx(m: Money, rate: FxRate, asOf?: string): Money {
  void asOf;
  if (rate.from !== m.currency) {
    throw new MoneyError(`convertFx: rate.from ${rate.from} does not match amount currency ${m.currency}`);
  }
  if (!(rate.rate > 0) || !Number.isFinite(rate.rate)) {
    throw new MoneyError(`convertFx: rate must be a positive finite number, got ${rate.rate}`);
  }
  return { amount: roundHalfAwayFromZero(m.amount * rate.rate), currency: rate.to };
}

/**
 * Allocate a total across `weights` so the parts sum EXACTLY to the total (largest-remainder
 * method). Used by ASC 606 transaction-price allocation and partner splits. No minor unit is
 * lost or invented.
 */
export function allocate(total: Money, weights: number[]): Money[] {
  if (weights.length === 0) throw new MoneyError('allocate: weights must be non-empty');
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new MoneyError('allocate: weights must be non-negative finite numbers');
  }
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (weightSum <= 0) throw new MoneyError('allocate: weights must sum to a positive value');

  const sign = total.amount < 0 ? -1 : 1;
  const magnitude = Math.abs(total.amount);
  const exact = weights.map((w) => (magnitude * w) / weightSum);
  const floors = exact.map((x) => Math.floor(x));
  let remainder = magnitude - floors.reduce((s, f) => s + f, 0);

  // Distribute the leftover minor units to the largest fractional parts.
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((p, q) => q.frac - p.frac || p.i - q.i);
  const result = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++) {
    result[order[k]!.i]!++;
    remainder--;
  }
  return result.map((amount) => ({ amount: sign * amount, currency: total.currency }));
}

/** Sum a list of same-currency amounts; `currency` seeds the zero for an empty list. */
export function sum(amounts: Money[], currency: CurrencyCode): Money {
  return amounts.reduce((acc, m) => add(acc, m), money(0, currency));
}

/** Convert to a major-unit decimal number (for ratios/display only). Assumes 2 minor digits. */
export function toDecimal(m: Money): number {
  return m.amount / 100;
}

/** Parse a major-unit decimal into exact minor units, rounding half-away-from-zero. */
export function fromDecimal(major: number, currency: CurrencyCode): Money {
  if (!Number.isFinite(major)) throw new MoneyError(`fromDecimal: value must be finite, got ${major}`);
  assertCurrency(currency);
  return { amount: roundHalfAwayFromZero(major * 100), currency };
}

/** Deterministic half-away-from-zero rounding (avoids banker's-rounding surprises in finance). */
function roundHalfAwayFromZero(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** Format minor units as a decimal string (display helper). */
export function format(m: Money): string {
  const major = m.amount / 100;
  return `${m.currency} ${major.toFixed(2)}`;
}
