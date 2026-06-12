/**
 * Contract amendment diffing (S30).
 *
 * Amendments that never reach billing are a top leakage source. This module diffs two contract
 * term-sets (e.g. pre/post amendment) and classifies each change — added/removed/changed terms,
 * price moves, quantity moves, escalator changes — so the recon core can check whether billing
 * reflects the amendment. Deterministic; integer money throughout.
 */
import { subtract, compare, multiplyByQuantity, type Money } from '../money/money.ts';
import type { ContractTerm } from '../core/model.ts';

export class AmendmentError extends Error {
  constructor(message: string) { super(message); this.name = 'AmendmentError'; }
}

export type TermChangeKind = 'added' | 'removed' | 'price_changed' | 'quantity_changed' | 'escalator_changed' | 'unchanged';

export interface TermDelta {
  readonly termId: string;
  readonly kind: TermChangeKind;
  readonly before: ContractTerm | null;
  readonly after: ContractTerm | null;
  /** annualized value impact (after - before); positive = more revenue expected. */
  readonly valueImpact: Money;
}

function annualValue(term: ContractTerm): Money {
  const period = multiplyByQuantity(term.unitPrice, term.quantity);
  return term.billingPeriod === 'monthly' ? multiplyByQuantity(period, 12) : period;
}

function zeroLike(m: Money): Money {
  return { amount: 0, currency: m.currency };
}

/**
 * Diff two term-sets by term id. Returns one delta per term that appears in either version.
 * For a changed term we pick the most salient single change kind (price > quantity > escalator).
 */
export function diffTerms(before: ContractTerm[], after: ContractTerm[]): TermDelta[] {
  const beforeMap = new Map(before.map((t) => [t.id, t]));
  const afterMap = new Map(after.map((t) => [t.id, t]));
  const ids = new Set<string>([...beforeMap.keys(), ...afterMap.keys()]);
  const deltas: TermDelta[] = [];

  for (const id of ids) {
    const b = beforeMap.get(id) ?? null;
    const a = afterMap.get(id) ?? null;

    if (b === null && a !== null) {
      deltas.push({ termId: id, kind: 'added', before: null, after: a, valueImpact: annualValue(a) });
      continue;
    }
    if (b !== null && a === null) {
      deltas.push({ termId: id, kind: 'removed', before: b, after: null, valueImpact: subtract(zeroLike(annualValue(b)), annualValue(b)) });
      continue;
    }
    // both present
    const bb = b!, aa = a!;
    if (bb.unitPrice.currency !== aa.unitPrice.currency) {
      throw new AmendmentError(`Currency changed for term ${id}; not supported by diff`);
    }
    const impact = subtract(annualValue(aa), annualValue(bb));
    let kind: TermChangeKind = 'unchanged';
    if (compare(bb.unitPrice, aa.unitPrice) !== 0) kind = 'price_changed';
    else if (bb.quantity !== aa.quantity) kind = 'quantity_changed';
    else if (bb.escalatorPercent !== aa.escalatorPercent) kind = 'escalator_changed';
    deltas.push({ termId: id, kind, before: bb, after: aa, valueImpact: impact });
  }
  return deltas;
}

/** Only the deltas that represent a real change (drops 'unchanged'). */
export function materialChanges(deltas: TermDelta[]): TermDelta[] {
  return deltas.filter((d) => d.kind !== 'unchanged');
}

/** Net annualized value impact of an amendment across all term changes. */
export function netAmendmentImpact(deltas: TermDelta[], currency: string): Money {
  return deltas.reduce<Money>(
    (acc, d) => ({ amount: acc.amount + d.valueImpact.amount, currency }),
    { amount: 0, currency },
  );
}

/**
 * Given the diff and what billing currently reflects (the "live" billed term-set), find terms
 * whose amended value is NOT yet reflected in billing — i.e. amendment-to-billing leakage.
 */
export interface AmendmentLeak {
  readonly termId: string;
  readonly expectedAnnual: Money;
  readonly billedAnnual: Money;
  readonly gap: Money;
}

export function amendmentBillingGap(
  amendedTerms: ContractTerm[], billedTerms: ContractTerm[],
): AmendmentLeak[] {
  const billedMap = new Map(billedTerms.map((t) => [t.id, t]));
  const leaks: AmendmentLeak[] = [];
  for (const term of amendedTerms) {
    const expected = annualValue(term);
    const billed = billedMap.get(term.id);
    const billedAnnual = billed ? annualValue(billed) : zeroLike(expected);
    const gap = subtract(expected, billedAnnual);
    if (compare(gap, zeroLike(expected)) > 0) {
      leaks.push({ termId: term.id, expectedAnnual: expected, billedAnnual, gap });
    }
  }
  return leaks;
}
