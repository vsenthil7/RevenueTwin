import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PolicyError, ApprovalPolicyEngine,
  type PolicyRule, type PolicyOutcome, type PolicyContext,
} from '../../src/policy/approval-policy.ts';
import { money } from '../../src/money/money.ts';

const DEFAULT: PolicyOutcome = { requiredApprovals: 1, requiredRoles: [], forceEscalation: false, label: 'standard' };

function ctx(over: Partial<PolicyContext> = {}): PolicyContext {
  return { amount: money(1000_00, 'GBP'), leakageType: 'intent', customerTier: 'enterprise', detectedViaWorkIQ: false, ...over };
}

const bigRule: PolicyRule = {
  id: 'big',
  condition: { minAmount: money(10000_00, 'GBP') },
  outcome: { requiredApprovals: 2, requiredRoles: ['cfo'], forceEscalation: true, label: 'high-value' },
};
const workIQRule: PolicyRule = {
  id: 'workiq',
  condition: { workIQOnly: true, leakageTypes: ['intent'] },
  outcome: { requiredApprovals: 2, requiredRoles: ['controller'], forceEscalation: false, label: 'workiq-review' },
};

test('constructor rejects duplicate rule ids', () => {
  assert.throws(() => new ApprovalPolicyEngine([bigRule, { ...bigRule }], DEFAULT), PolicyError);
});

test('constructor rejects rules / default with < 1 approval', () => {
  const bad: PolicyRule = { ...bigRule, id: 'bad', outcome: { ...bigRule.outcome, requiredApprovals: 0 } };
  assert.throws(() => new ApprovalPolicyEngine([bad], DEFAULT), PolicyError);
  assert.throws(() => new ApprovalPolicyEngine([], { ...DEFAULT, requiredApprovals: 0 }), PolicyError);
});

test('evaluate returns first matching rule (first-match-wins)', () => {
  const engine = new ApprovalPolicyEngine([bigRule, workIQRule], DEFAULT);
  const r = engine.evaluate(ctx({ amount: money(20000_00, 'GBP') }));
  assert.equal(r.matchedRuleId, 'big');
  assert.equal(r.outcome.requiredApprovals, 2);
});

test('evaluate falls through to default when nothing matches', () => {
  const engine = new ApprovalPolicyEngine([bigRule], DEFAULT);
  const r = engine.evaluate(ctx());
  assert.equal(r.matchedRuleId, null);
  assert.equal(r.outcome.label, 'standard');
});

test('condition matching: maxAmount, leakageTypes, customerTiers, workIQOnly', () => {
  const maxRule: PolicyRule = { id: 'small', condition: { maxAmount: money(500_00, 'GBP') }, outcome: DEFAULT };
  const tierRule: PolicyRule = { id: 'strat', condition: { customerTiers: ['strategic'] }, outcome: { ...DEFAULT, label: 'strategic' } };
  const engine = new ApprovalPolicyEngine([maxRule, workIQRule, tierRule], DEFAULT);
  // maxAmount: 400 <= 500 matches 'small'
  assert.equal(engine.evaluate(ctx({ amount: money(400_00, 'GBP') })).matchedRuleId, 'small');
  // workIQ + intent matches
  assert.equal(engine.evaluate(ctx({ detectedViaWorkIQ: true })).matchedRuleId, 'workiq');
  // workIQOnly fails when not workIQ; leakageType mismatch also fails -> tier
  assert.equal(engine.evaluate(ctx({ customerTier: 'strategic' })).matchedRuleId, 'strat');
  // leakageType not in list fails the workiq rule
  assert.equal(engine.evaluate(ctx({ detectedViaWorkIQ: true, leakageType: 'tax' })).matchedRuleId, null);
});

test('isSatisfied checks approver count and required roles', () => {
  const engine = new ApprovalPolicyEngine([bigRule], DEFAULT);
  const big = ctx({ amount: money(20000_00, 'GBP') });
  assert.equal(engine.isSatisfied(big, ['u1'], ['cfo']), false); // needs 2 approvers
  assert.equal(engine.isSatisfied(big, ['u1', 'u2'], ['controller']), false); // missing cfo role
  assert.equal(engine.isSatisfied(big, ['u1', 'u2'], ['cfo', 'controller']), true);
  // default path: 1 approver, no role requirement
  assert.equal(engine.isSatisfied(ctx(), ['u1'], []), true);
});
