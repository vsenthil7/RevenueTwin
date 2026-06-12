/**
 * Work IQ — commercial-intent reconciliation (S52 — Block R foundation, the MOAT).
 *
 * The differentiator: most revenue-assurance tools reconcile structured billing against
 * structured contracts and miss leakage that was AGREED in unstructured comms (a QBR, an email,
 * a meeting) but never made it into a machine-readable contract or invoice. Work IQ turns that
 * commercial-intent signal into a structured variance the deterministic engine can act on.
 *
 * The proof (exercised by the offline + live demos): on the planted Northwind leak, running with
 * Work IQ OFF detects **0** leaks (blind — the billing matches the *written* contract), while
 * Work IQ ON detects exactly **1** (sighted — it sees the agreed-but-unwritten uplift). That
 * recall delta — blind 0 vs sighted 1 — is the moat made measurable.
 */
import type { CommercialIntentEvent, ContractTerm } from '../core/model.ts';
import { money, applyPercentage, type Money } from '../money/money.ts';
import type { VarianceInput } from '../core/reconciliation.ts';

/** Work IQ configuration: whether intent signals are read, and the confidence floor to accept. */
export interface WorkIQConfig {
  /** When false, commercial-intent signals are ignored entirely (the "blind" baseline). */
  readonly enabled: boolean;
  /** Minimum extraction confidence to admit a signal, 0..1. */
  readonly minConfidence: number;
}

/** Work IQ engaged: read intent signals at/above 0.7 confidence. */
export const WORKIQ_ON: WorkIQConfig = { enabled: true, minConfidence: 0.7 };

/** Work IQ disengaged: the blind baseline that only sees the written contract. */
export const WORKIQ_OFF: WorkIQConfig = { enabled: false, minConfidence: 0.7 };

/**
 * Translate a commercial-intent event into a reconciliation variance input. Returns null when:
 *  - Work IQ is disabled (blind baseline), or
 *  - the signal is below the confidence floor, or
 *  - the signal carries no agreed uplift, or
 *  - the agreed uplift was already billed (no variance).
 *
 * `term` is the contract term the intent modifies; `billedUpliftPercent` is what billing actually
 * applied. `ageDays` ages the obligation for the net-recoverable model downstream.
 */
export function intentVarianceInput(
  event: CommercialIntentEvent,
  term: ContractTerm,
  billedUpliftPercent: number,
  ageDays: number,
  config: WorkIQConfig,
): VarianceInput | null {
  if (!config.enabled) return null;
  if (event.confidence < config.minConfidence) return null;
  const agreed = event.upliftPercent;
  if (agreed === undefined || agreed <= 0) return null;
  if (agreed <= billedUpliftPercent) return null;

  const lineValue = lineAnnualValue(term);
  const expected = applyPercentage(lineValue, agreed);
  const actual = applyPercentage(lineValue, billedUpliftPercent);

  return {
    id: `intent-${event.id}`,
    type: 'intent',
    expected,
    actual,
    confidence: event.confidence,
    ageDays,
    contractStrength: 1,
    field: 'upliftPercent',
    name: `Agreed ${agreed}% uplift not billed (${event.source})`,
  };
}

/** Annualized base value of a contract term (before uplift): unitPrice × quantity × periods/yr. */
export function lineAnnualValue(term: ContractTerm): Money {
  const periodsPerYear = term.billingPeriod === 'monthly' ? 12 : 1;
  const perPeriod = term.unitPrice.amount * term.quantity;
  return money(perPeriod * periodsPerYear, term.unitPrice.currency);
}

/**
 * Recall over a set of intent events given a config: how many yield an actionable variance.
 * Used by the demos to make the blind-vs-sighted delta a single number.
 */
export function recall(
  events: { event: CommercialIntentEvent; term: ContractTerm; billed: number; ageDays: number }[],
  config: WorkIQConfig,
): number {
  let detected = 0;
  for (const e of events) {
    if (intentVarianceInput(e.event, e.term, e.billed, e.ageDays, config) !== null) detected++;
  }
  return detected;
}
