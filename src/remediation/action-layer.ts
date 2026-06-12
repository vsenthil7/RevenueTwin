/**
 * Remediation action layer (S53 — Block R foundation).
 *
 * The safety gate between "we found leakage" and "we touched a customer's bill". A remediation
 * moves through propose → approve → execute, and can be reversed. Nothing downstream (billing
 * write-back) may act until `isExecuted(proposalId)` is true — i.e. a human with the right
 * permission approved it and it was executed. Every state change is idempotent and recorded, so
 * replays are safe and the trail is complete. This is what makes the system trustworthy enough to
 * let near a real ledger.
 */
import { AuditLog } from '../core/audit.ts';

export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionError';
  }
}

export type ProposalStatus = 'proposed' | 'approved' | 'executed' | 'reversed';

/** A proposed remediation against a case (e.g. issue a credit note for £1,200.00). */
export interface Proposal {
  readonly id: string;
  readonly caseId: string;
  readonly kind: string;
  status: ProposalStatus;
  readonly proposedBy: string;
  approvedBy?: string;
}

/**
 * The action layer. Holds proposals and enforces the legal status progression. Reversible: an
 * executed proposal can be reversed (the only backward move), which is what lets a kill switch
 * unwind a remediation safely.
 */
export class ActionLayer {
  private proposals = new Map<string, Proposal>();

  constructor(private audit: AuditLog = new AuditLog()) {}

  /** Propose a remediation. Idempotent on id (re-proposing returns the existing one). */
  propose(id: string, caseId: string, kind: string, proposedBy: string): Proposal {
    const existing = this.proposals.get(id);
    if (existing) return existing;
    const p: Proposal = { id, caseId, kind, status: 'proposed', proposedBy };
    this.proposals.set(id, p);
    this.audit.append(proposedBy, 'remediation.proposed', id, { caseId, kind });
    return p;
  }

  /** Approve a proposed remediation. Requires a different approver (separation of duties). */
  approve(id: string, approvedBy: string): Proposal {
    const p = this.require(id);
    if (p.status === 'approved' || p.status === 'executed') return p; // idempotent
    if (p.status !== 'proposed') throw new ActionError(`Cannot approve ${id} in status ${p.status}`);
    if (approvedBy === p.proposedBy) {
      throw new ActionError(`Separation of duties: ${approvedBy} cannot approve their own proposal ${id}`);
    }
    p.status = 'approved';
    p.approvedBy = approvedBy;
    this.audit.append(approvedBy, 'remediation.approved', id, { caseId: p.caseId });
    return p;
  }

  /** Execute an approved remediation. Idempotent. */
  execute(id: string, executedBy: string): Proposal {
    const p = this.require(id);
    if (p.status === 'executed') return p; // idempotent
    if (p.status !== 'approved') throw new ActionError(`Cannot execute ${id} in status ${p.status}`);
    p.status = 'executed';
    this.audit.append(executedBy, 'remediation.executed', id, { caseId: p.caseId });
    return p;
  }

  /** Reverse an executed remediation (the kill switch). Idempotent. */
  reverse(id: string, reversedBy: string, reason: string): Proposal {
    const p = this.require(id);
    if (p.status === 'reversed') return p; // idempotent
    if (p.status !== 'executed') throw new ActionError(`Cannot reverse ${id} in status ${p.status}`);
    p.status = 'reversed';
    this.audit.append(reversedBy, 'remediation.reversed', id, { caseId: p.caseId, reason });
    return p;
  }

  /** The gate downstream services check before touching money. */
  isExecuted(id: string): boolean {
    return this.proposals.get(id)?.status === 'executed';
  }

  /** Look up a proposal, or null. */
  get(id: string): Proposal | null {
    return this.proposals.get(id) ?? null;
  }

  private require(id: string): Proposal {
    const p = this.proposals.get(id);
    if (!p) throw new ActionError(`Unknown proposal ${id}`);
    return p;
  }
}
