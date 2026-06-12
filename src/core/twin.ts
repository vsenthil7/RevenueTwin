/**
 * Revenue Twin state machine (S51 — Block R foundation).
 *
 * A per-customer digital twin of the revenue relationship's lifecycle. Wraps the canonical
 * `TwinState` + transition table with a validated, audited transition engine and a queryable
 * timeline — the backbone of the Revenue Twin Explorer. Illegal transitions are rejected; every
 * legal one is recorded with its timestamp so the history is a defensible chronology.
 *
 * Persistence is separate (`TwinStore`); this is the in-process decision + timeline engine, kept
 * deterministic via an injectable clock.
 */
import {
  type TwinState, type CaseStatus, CASE_TRANSITIONS, canTransition, isTerminal,
} from '../core/model.ts';

export class TwinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TwinError';
  }
}

/** One recorded transition in a twin's timeline. */
export interface TwinTransition {
  readonly from: TwinState;
  readonly to: TwinState;
  readonly at: string;
  readonly actor: string;
  readonly reason?: string;
}

/** The twin lifecycle as a typed state machine over `TwinState`. */
export const TWIN_TRANSITIONS: Record<TwinState, TwinState[]> = {
  open: ['triaged', 'rejected'],
  triaged: ['approved', 'rejected'],
  approved: ['in_dispute', 'partially_recovered', 'recovered', 'written_off'],
  in_dispute: ['partially_recovered', 'recovered', 'written_off'],
  partially_recovered: ['recovered', 'written_off'],
  recovered: [],
  written_off: [],
  rejected: [],
};

/** True iff `to` is a legal next twin state from `from`. */
export function canTwinTransition(from: TwinState, to: TwinState): boolean {
  return TWIN_TRANSITIONS[from].includes(to);
}

/** True iff a twin state admits no further transitions. */
export function isTwinTerminal(state: TwinState): boolean {
  return TWIN_TRANSITIONS[state].length === 0;
}

/**
 * A single customer's revenue-twin timeline. Starts at `open`. `transition` validates against
 * `TWIN_TRANSITIONS` and appends to the immutable history; `current` is the latest state.
 */
export class TwinTimeline {
  private state: TwinState = 'open';
  private transitions: TwinTransition[] = [];

  constructor(
    readonly customerId: string,
    private clock: () => string = () => new Date().toISOString(),
    initial: TwinState = 'open',
  ) {
    this.state = initial;
  }

  /** The current twin state. */
  get current(): TwinState {
    return this.state;
  }

  /** Whether the twin has reached a terminal state. */
  get terminal(): boolean {
    return isTwinTerminal(this.state);
  }

  /** Immutable transition history (defensive copy). */
  history(): TwinTransition[] {
    return [...this.transitions];
  }

  /** Legal next states from the current state. */
  nextStates(): TwinState[] {
    return [...TWIN_TRANSITIONS[this.state]];
  }

  /**
   * Transition to `to`. Throws `TwinError` if the move is illegal from the current state.
   * Records the transition with the injected clock and the acting principal.
   */
  transition(to: TwinState, actor: string, reason?: string): TwinTransition {
    if (!canTwinTransition(this.state, to)) {
      throw new TwinError(`Illegal twin transition ${this.state} → ${to} for ${this.customerId}`);
    }
    const t: TwinTransition = {
      from: this.state,
      to,
      at: this.clock(),
      actor,
      ...(reason !== undefined ? { reason } : {}),
    };
    this.transitions.push(t);
    this.state = to;
    return t;
  }
}

/**
 * Map a case status to its corresponding twin state. The case workflow has operational states
 * (`in_review`, `escalated`) that collapse onto the twin's `triaged`; everything else is 1:1.
 */
export function caseStatusToTwinState(status: CaseStatus): TwinState {
  switch (status) {
    case 'in_review':
    case 'escalated':
      return 'triaged';
    case 'open':
    case 'approved':
    case 'rejected':
    case 'in_dispute':
    case 'partially_recovered':
    case 'recovered':
    case 'written_off':
      return status;
  }
}

/** Re-export of the case-level transition helpers for callers that work at the case grain. */
export { CASE_TRANSITIONS, canTransition, isTerminal };
