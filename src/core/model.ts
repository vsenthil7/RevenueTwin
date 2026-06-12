/**
 * Canonical domain model (S48 — Block R foundation).
 *
 * The single shared vocabulary every module speaks: customers, contracts, invoices, the
 * commercial-intent signal (the Work IQ moat), variance findings, leakage cases, and the
 * revenue-twin lifecycle states. Pure types + a few total helpers — no I/O, no money math here
 * (that lives in money.ts), so this module is dependency-light and import-safe everywhere.
 */
import type { Money } from '../money/money.ts';

/* ─────────────────────────────── Core entities ─────────────────────────────── */

export interface Customer {
  readonly id: string;
  readonly name: string;
  readonly arr: Money;
  readonly region: string;
}

export interface Contract {
  readonly id: string;
  readonly customerId: string;
  readonly startDate: string;
  readonly endDate: string;
  /** Whether the contract is machine-readable (structured) vs. needing Work IQ extraction. */
  readonly machineReadable: boolean;
}

export type BillingPeriod = 'monthly' | 'annual';

export interface ContractTerm {
  readonly id: string;
  readonly contractId: string;
  readonly product: string;
  readonly unitPrice: Money;
  readonly quantity: number;
  readonly billingPeriod: BillingPeriod;
  /** Annual escalator in percent units (0 = none). */
  readonly escalatorPercent: number;
}

export interface Invoice {
  readonly id: string;
  readonly customerId: string;
  readonly issueDate: string;
  readonly currency: string;
}

export interface InvoiceLine {
  readonly id: string;
  readonly invoiceId: string;
  readonly product: string;
  readonly amount: Money;
  readonly quantity: number;
}

/** A renewal record for the at-risk pipeline. */
export interface Renewal {
  readonly id: string;
  readonly contractId: string;
  readonly currentEndDate: string;
  /** Whether the contractual escalator was applied at renewal (a common leakage point). */
  readonly escalatorApplied: boolean;
}

/* ─────────────────────────── Work IQ commercial intent ─────────────────────── */

/** Where an intent signal was captured. */
export type IntentSource = 'email' | 'meeting' | 'qbr';

/**
 * A structured commercial-intent event — the output of Work IQ. This is the moat: signals that
 * a contract change was AGREED in unstructured comms but never reflected in billing.
 */
export interface CommercialIntentEvent {
  readonly id: string;
  readonly customerId: string;
  readonly source: IntentSource;
  readonly capturedAt: string;
  /** The exact text span the signal was extracted from (evidence). */
  readonly extractedSpan: string;
  /** e.g. 'price_increase', 'seat_expansion', 'discount_grant'. */
  readonly intentType: string;
  /** Optional agreed uplift in percent units. */
  readonly upliftPercent?: number;
  /** Extraction confidence, 0..1. */
  readonly confidence: number;
  /** Deep link back to the source record (auditability). */
  readonly deepLink: string;
}

/* ─────────────────────────── Leakage cases & findings ──────────────────────── */

/** The categories of revenue leakage the engine reconciles. */
export type LeakageType =
  | 'contract'
  | 'invoice'
  | 'customer'
  | 'intent'
  | 'price_changed'
  | 'quantity_changed'
  | 'escalator_changed'
  | 'usage_overage'
  | 'tax'
  | 'recognition';

/**
 * One variance the reconciliation engine found — the atomic unit of leakage. `netRecoverable`
 * is the legally-recoverable amount (after the net-recoverable legal model). Descriptive fields
 * (`field`, `name`, `expected`, `actual`) are optional context for the UI/evidence pack.
 */
export interface VarianceFinding {
  readonly id: string;
  readonly type: LeakageType;
  readonly netRecoverable: Money;
  /** The contract/invoice field that diverged, when applicable. */
  readonly field?: string;
  /** Human-readable label. */
  readonly name?: string;
  /** Expected (contractual) value. */
  readonly expected?: Money;
  /** Actual (billed) value. */
  readonly actual?: Money;
}

/** The revenue-twin lifecycle states (8-state machine). */
export type TwinState =
  | 'open'
  | 'triaged'
  | 'approved'
  | 'in_dispute'
  | 'partially_recovered'
  | 'recovered'
  | 'written_off'
  | 'rejected';

/** Case workflow status (superset of twin states with the operational `escalated`/`in_review`). */
export type CaseStatus =
  | 'open'
  | 'in_review'
  | 'escalated'
  | 'approved'
  | 'rejected'
  | 'in_dispute'
  | 'partially_recovered'
  | 'recovered'
  | 'written_off';

/** A triage decision applied to a case. */
export type Decision = 'approve' | 'reject' | 'escalate';

/** A unit of detected leakage: one customer, one or more findings, a status, an audit trail. */
export interface LeakageCase {
  readonly id: string;
  readonly customerId: string;
  readonly findings: VarianceFinding[];
  status: CaseStatus;
  readonly createdAt: string;
  /** True iff the Work IQ commercial-intent loop surfaced this (moat attribution). */
  readonly detectedViaWorkIQ?: boolean;
}

/* ─────────────────────────────── Helpers ──────────────────────────────────── */

/** Valid forward transitions of the twin/case lifecycle. Terminal states map to []. */
export const CASE_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  open: ['in_review', 'escalated', 'approved', 'rejected'],
  in_review: ['approved', 'rejected', 'escalated'],
  escalated: ['approved', 'rejected'],
  approved: ['in_dispute', 'partially_recovered', 'recovered', 'written_off'],
  in_dispute: ['partially_recovered', 'recovered', 'written_off'],
  partially_recovered: ['recovered', 'written_off'],
  recovered: [],
  rejected: [],
  written_off: [],
};

/** True iff `to` is a legal next status from `from`. */
export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}

/** True iff the status admits no further transitions. */
export function isTerminal(status: CaseStatus): boolean {
  return CASE_TRANSITIONS[status].length === 0;
}
