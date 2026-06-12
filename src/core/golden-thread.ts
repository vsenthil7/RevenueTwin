/**
 * The Golden Thread — the planted Northwind leak (S52 — Block R foundation).
 *
 * One named, CI-gated end-to-end scenario that defines "submittable": a customer (Northwind) whose
 * written contract bills no uplift, but whose QBR transcript records an AGREED 10% uplift. Billing
 * matches the written contract, so a blind reconciler finds nothing. Work IQ reads the QBR intent,
 * the deterministic engine reconciles agreed-vs-billed, and a £1,200.00 recoverable leak surfaces.
 *
 * Calibration is exact and load-bearing: with Work IQ ON the net recoverable is **£1,200.00
 * (120000 minor units)** at age 0; with Work IQ OFF it is **£0** (0 leaks). The demos assert this.
 */
import type { CommercialIntentEvent, ContractTerm } from '../core/model.ts';
import { money } from '../money/money.ts';

/** Northwind's affected contract term: £1,000.00/seat × 1 seat, billed monthly, no written uplift. */
const NORTHWIND_TERM: ContractTerm = {
  id: 'northwind-term-1',
  contractId: 'northwind-contract-1',
  product: 'Platform — Enterprise',
  unitPrice: money(1000_00, 'GBP'),
  quantity: 1,
  billingPeriod: 'monthly',
  escalatorPercent: 0,
};

/** The QBR commercial-intent signal: an agreed 10% uplift, high confidence, with evidence. */
const NORTHWIND_QBR: CommercialIntentEvent = {
  id: 'northwind-qbr-2026Q1',
  customerId: 'northwind',
  source: 'qbr',
  capturedAt: '2026-02-15T10:00:00.000Z',
  extractedSpan: 'Both sides agreed a 10% uplift effective next billing cycle.',
  intentType: 'price_increase',
  upliftPercent: 10,
  confidence: 0.95,
  deepLink: 'https://workiq/evidence/northwind-qbr-2026Q1',
};

/**
 * The planted leak. `billedUplift` = 0 (billing applied the written contract, no uplift),
 * `ageDays` = 0 (fresh — so net recoverable equals gross exactly: £1,200.00).
 */
export const NORTHWIND = {
  customerId: 'northwind',
  term: NORTHWIND_TERM,
  qbrEvent: NORTHWIND_QBR,
  billedUplift: 0,
  ageDays: 0,
} as const;
