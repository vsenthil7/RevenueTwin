/**
 * Billing write-back (S16).
 *
 * Turns an APPROVED, executed remediation into an actual corrective artifact in the billing
 * system — a credit note or a corrected invoice line. Goes through the existing action layer,
 * so the human gate, idempotency, reversibility, and audit all apply.
 *
 * `BillingWriter` is pluggable: production wires Stripe/Zuora/NetSuite; tests/pilots use the
 * in-memory writer. The writer is the ONLY place external money movement happens, and it is
 * never invoked unless `ActionLayer.isExecuted(proposalId)` is true.
 */
import type { Money } from '../money/money.ts';
import type { AuditLog } from '../core/audit.ts';
import type { ActionLayer } from '../remediation/action-layer.ts';

export class BillingError extends Error {
  constructor(message: string) { super(message); this.name = 'BillingError'; }
}

export type CorrectionKind = 'credit_note' | 'corrected_invoice_line';

export interface CorrectionRequest {
  readonly proposalId: string;
  readonly invoiceId: string;
  readonly amount: Money;
  readonly kind: CorrectionKind;
  readonly memo: string;
}

export interface CorrectionReceipt {
  readonly externalId: string;     // id returned by the billing system
  readonly proposalId: string;
  readonly invoiceId: string;
  readonly amount: Money;
  readonly kind: CorrectionKind;
  readonly status: 'posted' | 'voided';
  readonly postedAt: string;
}

/** Pluggable billing system. Implementations wrap a real API. Must be idempotent by proposalId. */
export interface BillingWriter {
  post(req: CorrectionRequest, at: string): Promise<CorrectionReceipt>;
  void(externalId: string, at: string): Promise<CorrectionReceipt>;
}

/** In-memory billing writer for pilots/demo/tests. Idempotent on proposalId. */
export class InMemoryBillingWriter implements BillingWriter {
  private byProposal = new Map<string, CorrectionReceipt>();
  private byExternal = new Map<string, CorrectionReceipt>();
  private seq = 1;

  async post(req: CorrectionRequest, at: string): Promise<CorrectionReceipt> {
    const existing = this.byProposal.get(req.proposalId);
    if (existing) return existing; // idempotent
    const receipt: CorrectionReceipt = {
      externalId: `bw-${this.seq++}`,
      proposalId: req.proposalId,
      invoiceId: req.invoiceId,
      amount: req.amount,
      kind: req.kind,
      status: 'posted',
      postedAt: at,
    };
    this.byProposal.set(req.proposalId, receipt);
    this.byExternal.set(receipt.externalId, receipt);
    return receipt;
  }

  async void(externalId: string, at: string): Promise<CorrectionReceipt> {
    const r = this.byExternal.get(externalId);
    if (!r) throw new BillingError(`Unknown correction ${externalId}`);
    if (r.status === 'voided') return r; // idempotent
    const voided: CorrectionReceipt = { ...r, status: 'voided', postedAt: at };
    this.byExternal.set(externalId, voided);
    this.byProposal.set(r.proposalId, voided);
    return voided;
  }
}

/**
 * Orchestrates write-back. Only posts a correction for a proposal the action layer has actually
 * executed (human-approved). Records the post and any void in the audit trail. Idempotent.
 */
export class BillingService {
  private receipts = new Map<string, CorrectionReceipt>();

  constructor(
    private writer: BillingWriter,
    private actions: ActionLayer,
    private audit: AuditLog,
  ) {}

  async postCorrection(req: CorrectionRequest, at: string): Promise<CorrectionReceipt> {
    if (!this.actions.isExecuted(req.proposalId)) {
      throw new BillingError(`Refusing write-back: proposal ${req.proposalId} is not approved/executed`);
    }
    const existing = this.receipts.get(req.proposalId);
    if (existing && existing.status === 'posted') return existing; // idempotent

    const receipt = await this.writer.post(req, at);
    this.receipts.set(req.proposalId, receipt);
    this.audit.append('billing-service', 'billing.correction_posted', req.invoiceId, {
      proposalId: req.proposalId, externalId: receipt.externalId,
      amount: req.amount.amount, kind: req.kind,
    });
    return receipt;
  }

  /** Void a previously posted correction (e.g. after a remediation reversal). Idempotent. */
  async voidCorrection(proposalId: string, at: string): Promise<CorrectionReceipt> {
    const receipt = this.receipts.get(proposalId);
    if (!receipt) throw new BillingError(`No correction posted for proposal ${proposalId}`);
    const voided = await this.writer.void(receipt.externalId, at);
    this.receipts.set(proposalId, voided);
    this.audit.append('billing-service', 'billing.correction_voided', receipt.invoiceId, {
      proposalId, externalId: receipt.externalId,
    });
    return voided;
  }

  receiptFor(proposalId: string): CorrectionReceipt | null {
    return this.receipts.get(proposalId) ?? null;
  }
}
