/**
 * Transaction-price allocation (S38) — ASC 606 step 4.
 *
 * Allocates a bundle's total transaction price across its performance obligations in proportion
 * to their standalone selling prices (SSP). Handles discount allocation and the residual method
 * for an obligation with no observable SSP. Deterministic; remainders distributed so allocations
 * sum exactly to the transaction price.
 */
import { money, add, subtract, compare, type Money } from '../money/money.ts';

export class AllocationError extends Error {
  constructor(message: string) { super(message); this.name = 'AllocationError'; }
}

export interface AllocItem {
  readonly id: string;
  readonly ssp: Money; // standalone selling price
}

export interface Allocation {
  readonly id: string;
  readonly ssp: Money;
  readonly allocated: Money;
}

function sameCurrency(items: { ssp?: Money }[], price: Money): void {
  for (const it of items) {
    if (it.ssp && it.ssp.currency !== price.currency) {
      throw new AllocationError('All SSPs must match the transaction-price currency');
    }
  }
}

/**
 * Relative-SSP allocation: each obligation gets transactionPrice * (ssp / totalSSP). The largest
 * obligation absorbs the rounding remainder so the allocation sums exactly to the price.
 */
export function allocateBySSP(items: AllocItem[], transactionPrice: Money): Allocation[] {
  if (items.length === 0) throw new AllocationError('At least one item required');
  sameCurrency(items, transactionPrice);
  const totalSSP = items.reduce((s, it) => s + it.ssp.amount, 0);
  if (totalSSP <= 0) throw new AllocationError('Total SSP must be > 0');

  const raw = items.map((it) => ({
    id: it.id, ssp: it.ssp,
    exact: (transactionPrice.amount * it.ssp.amount) / totalSSP,
  }));
  // floor each, then distribute the remainder to the largest fractional parts
  const floored = raw.map((r) => ({ ...r, alloc: Math.floor(r.exact), frac: r.exact - Math.floor(r.exact) }));
  let distributed = floored.reduce((s, f) => s + f.alloc, 0);
  let remainder = transactionPrice.amount - distributed;
  // sort indices by descending fractional part for deterministic remainder distribution
  const order = floored.map((_, i) => i).sort((a, b) => floored[b]!.frac - floored[a]!.frac || a - b);
  let oi = 0;
  while (remainder > 0) {
    const idx = order[oi % order.length]!;
    floored[idx]!.alloc += 1;
    remainder -= 1;
    oi += 1;
  }
  return floored.map((f) => ({ id: f.id, ssp: f.ssp, allocated: money(f.alloc, transactionPrice.currency) }));
}

/** Verify an allocation sums exactly to the transaction price. */
export function allocationSumsExactly(allocs: Allocation[], transactionPrice: Money): boolean {
  const sum = allocs.reduce<Money>((acc, a) => add(acc, a.allocated), money(0, transactionPrice.currency));
  return compare(sum, transactionPrice) === 0;
}

/**
 * Residual method: one obligation has no observable SSP; its allocated amount is the transaction
 * price minus the sum of the others' (observable) SSPs. Throws if the residual would be negative.
 */
export function allocateResidual(
  observable: AllocItem[], residualId: string, transactionPrice: Money,
): Allocation[] {
  sameCurrency(observable, transactionPrice);
  const observedTotal = observable.reduce<Money>((acc, it) => add(acc, it.ssp), money(0, transactionPrice.currency));
  const residual = subtract(transactionPrice, observedTotal);
  if (residual.amount < 0) throw new AllocationError('Residual would be negative');
  const allocs: Allocation[] = observable.map((it) => ({ id: it.id, ssp: it.ssp, allocated: it.ssp }));
  allocs.push({ id: residualId, ssp: money(0, transactionPrice.currency), allocated: residual });
  return allocs;
}

/**
 * Discount allocation: a bundle discount is spread across obligations in proportion to SSP (the
 * default under ASC 606 unless the discount relates to specific obligations). Returns net amounts.
 */
export function allocateDiscount(items: AllocItem[], totalDiscount: Money): Allocation[] {
  const grossTotal = items.reduce((s, it) => s + it.ssp.amount, 0);
  if (grossTotal <= 0) throw new AllocationError('Total SSP must be > 0');
  if (totalDiscount.amount < 0) throw new AllocationError('Discount must be >= 0');
  if (totalDiscount.amount > grossTotal) throw new AllocationError('Discount exceeds total SSP');
  const netPrice = money(grossTotal - totalDiscount.amount, totalDiscount.currency);
  return allocateBySSP(items, netPrice);
}
