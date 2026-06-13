/**
 * Partner / reseller revenue splits (S41).
 *
 * Splits revenue across multiple parties (vendor, reseller, referral partner) with percentage or
 * tiered-commission models, computing each party's share and the vendor's net-down. Deterministic;
 * remainders distributed so shares sum exactly to the gross.
 */
import { money, add, applyPercentage, subtract, type Money } from '../money/money.ts';

export class SplitError extends Error {
  constructor(message: string) { super(message); this.name = 'SplitError'; }
}

export interface PartyShare {
  readonly partyId: string;
  readonly percent: number; // share of gross, 0..100
}

export interface SplitLine {
  readonly partyId: string;
  readonly percent: number;
  readonly amount: Money;
}

/**
 * Percentage split of gross across parties. Percentages must sum to <= 100; any unallocated
 * remainder is the vendor's retained share (returned under partyId 'vendor_retained').
 * Penny remainder from rounding goes to the largest share for exact summation.
 */
export function percentageSplit(gross: Money, shares: PartyShare[]): SplitLine[] {
  if (shares.length === 0) throw new SplitError('At least one party share required');
  let totalPct = 0;
  for (const s of shares) {
    if (s.percent < 0 || s.percent > 100) throw new SplitError(`Invalid percent for ${s.partyId}`);
    totalPct += s.percent;
  }
  if (totalPct > 100 + 1e-9) throw new SplitError('Shares exceed 100%');

  const lines: { partyId: string; percent: number; amount: number }[] = shares.map((s) => ({
    partyId: s.partyId, percent: s.percent, amount: applyPercentage(gross, s.percent).amount,
  }));
  const retainedPct = Math.round((100 - totalPct) * 1e6) / 1e6;
  if (retainedPct > 0) {
    lines.push({ partyId: 'vendor_retained', percent: retainedPct, amount: applyPercentage(gross, retainedPct).amount });
  }
  // fix rounding so amounts sum exactly to gross: assign any remainder to the line with the
  // largest share (deterministic via reduce; first line wins ties).
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  const diff = gross.amount - sum;
  if (diff !== 0) {
    const maxIdx = lines.reduce((best, l, i) => (l.amount > lines[best]!.amount ? i : best), 0);
    lines[maxIdx]!.amount += diff;
  }
  return lines.map((l) => ({ partyId: l.partyId, percent: l.percent, amount: money(l.amount, gross.currency) }));
}

export interface CommissionTier {
  readonly upToVolume: number | null; // cumulative volume bound; null = unbounded
  readonly ratePercent: number;
}

/**
 * Tiered commission on a volume: graduated rates per band (like tiered pricing but yielding a
 * commission amount on a gross). Volume is a unit count; commission accrues per-band on the
 * proportional gross.
 */
export function tieredCommission(gross: Money, volume: number, tiers: CommissionTier[]): Money {
  if (volume < 0) throw new SplitError('volume must be >= 0');
  if (tiers.length === 0) throw new SplitError('At least one tier required');
  if (volume === 0) return money(0, gross.currency);

  let remaining = volume;
  let prevBound = 0;
  let commission = money(0, gross.currency);
  for (const tier of tiers) {
    if (remaining <= 0) break;
    const cap = tier.upToVolume === null ? Infinity : tier.upToVolume - prevBound;
    const inTier = Math.min(remaining, cap);
    // gross attributable to this band, pro-rata by volume
    const bandGross = applyPercentage(gross, Math.round((inTier / volume) * 10000) / 100);
    commission = add(commission, applyPercentage(bandGross, tier.ratePercent));
    remaining -= inTier;
    prevBound = tier.upToVolume ?? prevBound;
  }
  if (remaining > 0) throw new SplitError('Volume exceeds defined commission tiers');
  return commission;
}

/** Net-down: vendor revenue after subtracting all partner shares from gross. */
export function vendorNetDown(gross: Money, partnerShares: SplitLine[]): Money {
  const partnerTotal = partnerShares
    .filter((l) => l.partyId !== 'vendor_retained')
    .reduce<Money>((acc, l) => add(acc, l.amount), money(0, gross.currency));
  return subtract(gross, partnerTotal);
}

/** Verify split lines sum exactly to gross. */
export function splitSumsExactly(lines: SplitLine[], gross: Money): boolean {
  const sum = lines.reduce<Money>((acc, l) => add(acc, l.amount), money(0, gross.currency));
  return sum.amount === gross.amount;
}
