/**
 * ContractIntentMismatch (S83) - the most original reasoning artifact (IDEA-1 V03 sec 8).
 *
 * When Work IQ captures a commercial intent (e.g. a QBR 12% uplift) that conflicts with the
 * contracted term, that conflict is itself a first-class, scored case. The engine NEVER auto-
 * picks a side: it surfaces BOTH the contract position and the intent position, scores the
 * mismatch, and routes to a human for resolution. Deterministic detection + scoring; the human
 * decides. This is the contract<->intent conflict state the spec requires.
 */
import type { CommercialIntentEvent, ContractTerm } from '../core/model.ts';

export type MismatchKind =
  | 'uplift_not_in_contract'      // intent says price rose; contract has no such escalator
  | 'discount_not_in_contract'    // intent grants a discount the contract does not reflect
  | 'quantity_mismatch'           // intent implies seats/usage the contract did not capture
  | 'no_mismatch';

export type MismatchResolution = 'unresolved' | 'honor_contract' | 'honor_intent' | 'amend_contract';

export interface ContractIntentMismatch {
  readonly id: string;
  readonly customerId: string;
  readonly kind: MismatchKind;
  /** The contract position (what was signed). */
  readonly contractPosition: string;
  /** The intent position (what Work IQ captured). */
  readonly intentPosition: string;
  /** Evidence span from the intent source. */
  readonly intentSpan: string;
  /** 0..1 confidence the mismatch is real (NOT a confidence in which side wins). */
  readonly score: number;
  readonly resolution: MismatchResolution;
}

/** Detect + score a mismatch between a captured intent and the matching contract term.
 * Deterministic: same inputs -> same mismatch + score. Presents both sides; never auto-resolves. */
export function detectMismatch(
  id: string, intent: CommercialIntentEvent, term: ContractTerm | null,
): ContractIntentMismatch {
  const base = { id, customerId: intent.customerId, intentSpan: intent.extractedSpan, resolution: 'unresolved' as const };
  // No matching contract term at all -> the intent is entirely uncaptured.
  if (term === null) {
    return { ...base, kind: 'uplift_not_in_contract',
      contractPosition: 'No contract term on file for this commitment',
      intentPosition: intent.intentType + (' ') + (intent.upliftPercent != null ? intent.upliftPercent + '% uplift' : '(no quantified uplift)'),
      score: intent.confidence };
  }
  // Price-increase intent but the contract escalator does not reflect it.
  if (intent.intentType === 'price_increase' && (intent.upliftPercent ?? 0) > term.escalatorPercent) {
    const gap = (intent.upliftPercent as number) - term.escalatorPercent;
    return { ...base, kind: 'uplift_not_in_contract',
      contractPosition: 'Contract escalator ' + term.escalatorPercent + '%',
      intentPosition: 'Captured uplift ' + (intent.upliftPercent as number) + '%',
      score: Math.min(1, intent.confidence * (gap >= 5 ? 1 : 0.8)) };
  }
  // Discount-grant intent the contract does not reflect.
  if (intent.intentType === 'discount_grant') {
    return { ...base, kind: 'discount_not_in_contract',
      contractPosition: 'Contract unit price ' + term.unitPrice.amount + ' ' + term.unitPrice.currency,
      intentPosition: 'Discount commitment captured from ' + intent.source,
      score: intent.confidence };
  }
  // Seat/quantity expansion intent.
  if (intent.intentType === 'seat_expansion') {
    return { ...base, kind: 'quantity_mismatch',
      contractPosition: 'Contract quantity ' + term.quantity,
      intentPosition: 'Seat expansion captured from ' + intent.source,
      score: intent.confidence };
  }
  return { ...base, kind: 'no_mismatch', contractPosition: 'aligned', intentPosition: 'aligned', score: 0 };
}

export class MismatchError extends Error {
  constructor(message: string) { super(message); this.name = 'MismatchError'; }
}

/** Apply a human resolution. The engine never auto-resolves; a real mismatch needs a decision. */
export function resolveMismatch(m: ContractIntentMismatch, resolution: MismatchResolution): ContractIntentMismatch {
  if (m.kind === 'no_mismatch') throw new MismatchError('cannot resolve a non-mismatch');
  if (resolution === 'unresolved') throw new MismatchError('resolution must pick a side');
  return { ...m, resolution };
}

/** A mismatch is open (needs a human) iff it is a real mismatch still unresolved. */
export function isOpen(m: ContractIntentMismatch): boolean {
  return m.kind !== 'no_mismatch' && m.resolution === 'unresolved';
}
