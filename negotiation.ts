/**
 * Dispute & negotiation management (S24).
 *
 * After a leak is found and a correction proposed, the customer may dispute it. This module
 * tracks the negotiation: claimed amount, offers/counter-offers, settlement, and the resulting
 * recovered vs. conceded split — all in deterministic integer money, all audited upstream.
 */
import { money, subtract, add, compare, type Money } from '../money/money.ts';

export class DisputeError extends Error {
  constructor(message: string) { super(message); this.name = 'DisputeError'; }
}

export type DisputeStatus = 'open' | 'negotiating' | 'settled' | 'withdrawn' | 'escalated_legal';

export const DISPUTE_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  open: ['negotiating', 'withdrawn', 'escalated_legal'],
  negotiating: ['settled', 'escalated_legal', 'withdrawn'],
  escalated_legal: ['settled', 'withdrawn'],
  settled: [],
  withdrawn: [],
};

export function canTransitionDispute(from: DisputeStatus, to: DisputeStatus): boolean {
  return DISPUTE_TRANSITIONS[from].includes(to);
}

export type OfferParty = 'us' | 'customer';

export interface Offer {
  readonly party: OfferParty;
  readonly amount: Money;
  readonly at: string;
  readonly note: string;
}

export interface Dispute {
  readonly id: string;
  readonly caseId: string;
  readonly customerId: string;
  readonly claimedAmount: Money; // what we assert is recoverable
  status: DisputeStatus;
  readonly openedAt: string;
  offers: Offer[];
  settledAmount: Money | null;
  resolvedAt: string | null;
}

export function openDispute(id: string, caseId: string, customerId: string, claimed: Money, at: string): Dispute {
  if (claimed.amount <= 0) throw new DisputeError('Claimed amount must be positive');
  return {
    id, caseId, customerId, claimedAmount: claimed, status: 'open',
    openedAt: at, offers: [], settledAmount: null, resolvedAt: null,
  };
}

export function transitionDispute(d: Dispute, to: DisputeStatus): Dispute {
  if (!canTransitionDispute(d.status, to)) {
    throw new DisputeError(`Illegal dispute transition ${d.status} -> ${to}`);
  }
  d.status = to;
  return d;
}

/** Record an offer/counter. Must be in a negotiable status; amount within [0, claimed]. */
export function recordOffer(d: Dispute, offer: Offer): Dispute {
  if (d.status !== 'open' && d.status !== 'negotiating' && d.status !== 'escalated_legal') {
    throw new DisputeError(`Cannot record offer in status ${d.status}`);
  }
  if (offer.amount.amount < 0 || compare(offer.amount, d.claimedAmount) > 0) {
    throw new DisputeError('Offer must be within [0, claimedAmount]');
  }
  if (d.status === 'open') d.status = 'negotiating';
  d.offers.push(offer);
  return d;
}

/** The latest offer from a given party, or null. */
export function latestOffer(d: Dispute, party: OfferParty): Offer | null {
  for (let i = d.offers.length - 1; i >= 0; i--) {
    if (d.offers[i]!.party === party) return d.offers[i]!;
  }
  return null;
}

/** The gap between our latest ask and the customer's latest offer (0 if either missing). */
export function negotiationGap(d: Dispute): Money {
  const ours = latestOffer(d, 'us');
  const theirs = latestOffer(d, 'customer');
  if (!ours || !theirs) return money(0, d.claimedAmount.currency);
  const gap = subtract(ours.amount, theirs.amount);
  return gap.amount < 0 ? money(0, d.claimedAmount.currency) : gap;
}

export interface Settlement {
  readonly recovered: Money;
  readonly conceded: Money; // claimed - recovered
  readonly recoveryRatePct: number;
}

/** Settle a dispute at an agreed amount. Computes recovered/conceded split. Idempotent guard. */
export function settle(d: Dispute, agreed: Money, at: string): Settlement {
  if (d.status === 'settled') throw new DisputeError('Dispute already settled');
  if (!canTransitionDispute(d.status, 'settled')) {
    throw new DisputeError(`Cannot settle from status ${d.status}`);
  }
  if (agreed.amount < 0 || compare(agreed, d.claimedAmount) > 0) {
    throw new DisputeError('Settlement must be within [0, claimedAmount]');
  }
  d.status = 'settled';
  d.settledAmount = agreed;
  d.resolvedAt = at;
  const conceded = subtract(d.claimedAmount, agreed);
  const rate = (agreed.amount / d.claimedAmount.amount) * 100;
  return { recovered: agreed, conceded, recoveryRatePct: Math.round(rate * 100) / 100 };
}

/** Days a dispute has been open (or until resolution). */
export function disputeAgeDays(d: Dispute, now: string): number {
  const end = d.resolvedAt ?? now;
  const days = (Date.parse(end) - Date.parse(d.openedAt)) / 86_400_000;
  if (Number.isNaN(days)) throw new DisputeError('Invalid dispute dates');
  return Math.floor(days);
}

/** Portfolio settlement summary across many resolved disputes. */
export interface DisputePortfolio { recovered: Money; conceded: Money; settledCount: number; openCount: number; }

export function disputePortfolio(disputes: Dispute[], currency: string): DisputePortfolio {
  let recovered = money(0, currency);
  let conceded = money(0, currency);
  let settledCount = 0;
  let openCount = 0;
  for (const d of disputes) {
    if (d.status === 'settled' && d.settledAmount) {
      recovered = add(recovered, d.settledAmount);
      conceded = add(conceded, subtract(d.claimedAmount, d.settledAmount));
      settledCount += 1;
    } else if (d.status === 'open' || d.status === 'negotiating' || d.status === 'escalated_legal') {
      openCount += 1;
    }
  }
  return { recovered, conceded, settledCount, openCount };
}
