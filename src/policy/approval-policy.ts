/**
 * Approval policy engine (S25).
 *
 * Beyond a single dual-approval threshold: a configurable, ordered rule set that decides, per
 * case, how many approvers are required, which roles, and whether escalation is forced. Rules
 * match on amount, leakage type, customer tier, and Work IQ provenance. Deterministic, first-
 * match-wins with an explicit default, so routing is always defined and auditable.
 */
import { compare, type Money } from '../money/money.ts';
import type { LeakageType } from '../core/model.ts';

export class PolicyError extends Error {
  constructor(message: string) { super(message); this.name = 'PolicyError'; }
}

export interface PolicyContext {
  readonly amount: Money;
  readonly leakageType: LeakageType;
  readonly customerTier: 'strategic' | 'enterprise' | 'mid_market' | 'smb';
  readonly detectedViaWorkIQ: boolean;
}

export interface PolicyCondition {
  readonly minAmount?: Money;
  readonly maxAmount?: Money;
  readonly leakageTypes?: LeakageType[];
  readonly customerTiers?: PolicyContext['customerTier'][];
  readonly workIQOnly?: boolean;
}

export interface PolicyOutcome {
  readonly requiredApprovals: number;
  readonly requiredRoles: string[]; // roles that must be among approvers
  readonly forceEscalation: boolean;
  readonly label: string;
}

export interface PolicyRule {
  readonly id: string;
  readonly condition: PolicyCondition;
  readonly outcome: PolicyOutcome;
}

function matches(cond: PolicyCondition, ctx: PolicyContext): boolean {
  if (cond.minAmount !== undefined && compare(ctx.amount, cond.minAmount) < 0) return false;
  if (cond.maxAmount !== undefined && compare(ctx.amount, cond.maxAmount) > 0) return false;
  if (cond.leakageTypes !== undefined && !cond.leakageTypes.includes(ctx.leakageType)) return false;
  if (cond.customerTiers !== undefined && !cond.customerTiers.includes(ctx.customerTier)) return false;
  if (cond.workIQOnly === true && !ctx.detectedViaWorkIQ) return false;
  return true;
}

/**
 * An ordered policy. `evaluate` returns the first matching rule's outcome, or the default.
 * First-match-wins makes precedence explicit and testable.
 */
export class ApprovalPolicyEngine {
  constructor(private rules: PolicyRule[], private defaultOutcome: PolicyOutcome) {
    const ids = new Set<string>();
    for (const r of rules) {
      if (ids.has(r.id)) throw new PolicyError(`Duplicate rule id '${r.id}'`);
      ids.add(r.id);
      if (r.outcome.requiredApprovals < 1) throw new PolicyError(`Rule '${r.id}' requires >= 1 approval`);
    }
    if (defaultOutcome.requiredApprovals < 1) throw new PolicyError('Default requires >= 1 approval');
  }

  evaluate(ctx: PolicyContext): { matchedRuleId: string | null; outcome: PolicyOutcome } {
    for (const rule of this.rules) {
      if (matches(rule.condition, ctx)) {
        return { matchedRuleId: rule.id, outcome: rule.outcome };
      }
    }
    return { matchedRuleId: null, outcome: this.defaultOutcome };
  }

  /** Check whether a concrete approver set + roles satisfies the outcome for a context. */
  isSatisfied(ctx: PolicyContext, approvers: string[], approverRoles: string[]): boolean {
    const { outcome } = this.evaluate(ctx);
    if (approvers.length < outcome.requiredApprovals) return false;
    for (const role of outcome.requiredRoles) {
      if (!approverRoles.includes(role)) return false;
    }
    return true;
  }
}
