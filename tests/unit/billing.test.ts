import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BillingError, InMemoryBillingWriter, BillingService,
  type CorrectionRequest,
} from '../../src/billing/write-back.ts';
import { ActionLayer } from '../../src/remediation/action-layer.ts';
import { AuditLog } from '../../src/core/audit.ts';
import { money } from '../../src/money/money.ts';

function req(over: Partial<CorrectionRequest> = {}): CorrectionRequest {
  return { proposalId: 'p1', invoiceId: 'i1', amount: money(1200_00, 'GBP'), kind: 'credit_note', memo: 'agreed uplift', ...over };
}

/** Build an action layer with a proposal already executed (the gate open). */
function executedActions(proposalId = 'p1'): ActionLayer {
  const a = new ActionLayer(new AuditLog(() => '2026-01-01T00:00:00Z'));
  a.propose(proposalId, 'case1', 'credit_note', 'alice');
  a.approve(proposalId, 'bob');
  a.execute(proposalId, 'bob');
  return a;
}

/* ─────────────────── InMemoryBillingWriter ─────────────────── */

test('writer posts a receipt and is idempotent on proposalId', async () => {
  const w = new InMemoryBillingWriter();
  const r1 = await w.post(req(), '2026-01-01');
  assert.equal(r1.status, 'posted');
  assert.equal(r1.externalId, 'bw-1');
  const r2 = await w.post(req(), '2026-01-02');
  assert.equal(r2.externalId, 'bw-1'); // same receipt, not bw-2
});

test('writer voids by externalId and is idempotent', async () => {
  const w = new InMemoryBillingWriter();
  const posted = await w.post(req(), '2026-01-01');
  const voided = await w.void(posted.externalId, '2026-01-03');
  assert.equal(voided.status, 'voided');
  const again = await w.void(posted.externalId, '2026-01-04');
  assert.equal(again.status, 'voided');
});

test('writer void rejects unknown externalId', async () => {
  const w = new InMemoryBillingWriter();
  await assert.rejects(() => w.void('nope', '2026-01-01'), BillingError);
});

/* ─────────────────── BillingService ─────────────────── */

test('service refuses to post when the proposal is not executed', async () => {
  const actions = new ActionLayer();
  actions.propose('p1', 'case1', 'credit_note', 'alice'); // proposed only — gate closed
  const svc = new BillingService(new InMemoryBillingWriter(), actions, new AuditLog());
  await assert.rejects(() => svc.postCorrection(req(), '2026-01-01'), BillingError);
});

test('service posts once the action layer has executed the proposal', async () => {
  const audit = new AuditLog(() => '2026-01-01T00:00:00Z');
  const svc = new BillingService(new InMemoryBillingWriter(), executedActions(), audit);
  const receipt = await svc.postCorrection(req(), '2026-01-01');
  assert.equal(receipt.status, 'posted');
  assert.equal(svc.receiptFor('p1')?.externalId, receipt.externalId);
  // audit recorded the post
  assert.ok(audit.all().some((e) => e.event === 'billing.correction_posted'));
});

test('service postCorrection is idempotent for an already-posted proposal', async () => {
  const svc = new BillingService(new InMemoryBillingWriter(), executedActions(), new AuditLog());
  const r1 = await svc.postCorrection(req(), '2026-01-01');
  const r2 = await svc.postCorrection(req(), '2026-01-02');
  assert.equal(r1.externalId, r2.externalId);
});

test('service voids a posted correction and audits it', async () => {
  const audit = new AuditLog(() => '2026-01-01T00:00:00Z');
  const svc = new BillingService(new InMemoryBillingWriter(), executedActions(), audit);
  await svc.postCorrection(req(), '2026-01-01');
  const voided = await svc.voidCorrection('p1', '2026-01-05');
  assert.equal(voided.status, 'voided');
  assert.ok(audit.all().some((e) => e.event === 'billing.correction_voided'));
});

test('service voidCorrection rejects an unknown proposal', async () => {
  const svc = new BillingService(new InMemoryBillingWriter(), executedActions(), new AuditLog());
  await assert.rejects(() => svc.voidCorrection('unknown', '2026-01-01'), BillingError);
});

test('service receiptFor returns null when nothing posted', () => {
  const svc = new BillingService(new InMemoryBillingWriter(), executedActions(), new AuditLog());
  assert.equal(svc.receiptFor('p1'), null);
});
