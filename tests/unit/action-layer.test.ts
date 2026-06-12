import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionLayer, ActionError } from '../../src/remediation/action-layer.ts';
import { AuditLog } from '../../src/core/audit.ts';

function layer(): ActionLayer {
  return new ActionLayer(new AuditLog(() => '2026-01-01T00:00:00Z'));
}

test('propose creates a proposed remediation', () => {
  const a = layer();
  const p = a.propose('p1', 'case1', 'credit_note', 'alice');
  assert.equal(p.status, 'proposed');
  assert.equal(p.caseId, 'case1');
  assert.equal(p.proposedBy, 'alice');
});

test('propose is idempotent on id', () => {
  const a = layer();
  const first = a.propose('p1', 'case1', 'credit_note', 'alice');
  const second = a.propose('p1', 'caseX', 'other', 'bob');
  assert.equal(first, second);
  assert.equal(second.caseId, 'case1'); // original wins
});

test('approve moves proposed -> approved with a different approver', () => {
  const a = layer();
  a.propose('p1', 'case1', 'credit_note', 'alice');
  const p = a.approve('p1', 'bob');
  assert.equal(p.status, 'approved');
  assert.equal(p.approvedBy, 'bob');
});

test('approve enforces separation of duties', () => {
  const a = layer();
  a.propose('p1', 'case1', 'credit_note', 'alice');
  assert.throws(() => a.approve('p1', 'alice'), ActionError);
});

test('approve is idempotent and a no-op once executed', () => {
  const a = layer();
  a.propose('p1', 'case1', 'k', 'alice');
  a.approve('p1', 'bob');
  const again = a.approve('p1', 'carol');
  assert.equal(again.status, 'approved');
  assert.equal(again.approvedBy, 'bob'); // unchanged
  a.execute('p1', 'bob');
  const afterExec = a.approve('p1', 'dave');
  assert.equal(afterExec.status, 'executed'); // no-op
});

test('approve rejects from a non-proposed, non-approved state', () => {
  const a = layer();
  a.propose('p1', 'case1', 'k', 'alice');
  a.approve('p1', 'bob');
  a.execute('p1', 'bob');
  a.reverse('p1', 'bob', 'kill switch');
  assert.throws(() => a.approve('p1', 'carol'), ActionError);
});

test('execute requires approved and is idempotent', () => {
  const a = layer();
  a.propose('p1', 'case1', 'k', 'alice');
  assert.throws(() => a.execute('p1', 'bob'), ActionError); // not approved
  a.approve('p1', 'bob');
  const e1 = a.execute('p1', 'bob');
  const e2 = a.execute('p1', 'bob');
  assert.equal(e1.status, 'executed');
  assert.equal(e2.status, 'executed');
});

test('isExecuted is the downstream gate', () => {
  const a = layer();
  a.propose('p1', 'case1', 'k', 'alice');
  assert.equal(a.isExecuted('p1'), false);
  a.approve('p1', 'bob');
  assert.equal(a.isExecuted('p1'), false);
  a.execute('p1', 'bob');
  assert.equal(a.isExecuted('p1'), true);
  assert.equal(a.isExecuted('unknown'), false);
});

test('reverse requires executed and is idempotent (kill switch)', () => {
  const a = layer();
  a.propose('p1', 'case1', 'k', 'alice');
  a.approve('p1', 'bob');
  assert.throws(() => a.reverse('p1', 'bob', 'too soon'), ActionError); // not executed
  a.execute('p1', 'bob');
  const r1 = a.reverse('p1', 'bob', 'kill switch');
  const r2 = a.reverse('p1', 'bob', 'again');
  assert.equal(r1.status, 'reversed');
  assert.equal(r2.status, 'reversed');
  assert.equal(a.isExecuted('p1'), false);
});

test('require throws on unknown proposal across operations', () => {
  const a = layer();
  assert.throws(() => a.approve('nope', 'bob'), ActionError);
  assert.throws(() => a.execute('nope', 'bob'), ActionError);
  assert.throws(() => a.reverse('nope', 'bob', 'x'), ActionError);
});

test('get returns a proposal or null', () => {
  const a = layer();
  assert.equal(a.get('p1'), null);
  a.propose('p1', 'case1', 'k', 'alice');
  assert.equal(a.get('p1')?.id, 'p1');
});

test('default audit log constructs when none injected', () => {
  const a = new ActionLayer();
  const p = a.propose('p1', 'case1', 'k', 'alice');
  assert.equal(p.status, 'proposed');
});
