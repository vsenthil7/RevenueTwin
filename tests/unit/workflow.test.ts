import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WorkflowError, WorkflowEngine, InMemoryChannel, addHours, type WorkflowConfig,
} from '../../src/workflow/engine.ts';

const config: WorkflowConfig = { slaHours: 24, escalationTo: 'manager' };

function clockSeq(times: string[]): () => string {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)]!;
}

function engine(times: string[]): { wf: WorkflowEngine; channel: InMemoryChannel } {
  const channel = new InMemoryChannel('teams');
  const wf = new WorkflowEngine(channel, config, clockSeq(times));
  return { wf, channel };
}

test('addHours adds and rejects bad timestamps', () => {
  assert.equal(addHours('2026-01-01T00:00:00.000Z', 24), '2026-01-02T00:00:00.000Z');
  assert.throws(() => addHours('bad', 1), WorkflowError);
});

test('intake creates an item with an SLA deadline; rejects duplicates', async () => {
  const { wf } = engine(['2026-01-01T00:00:00.000Z']);
  const item = await wf.intake('case1', 'acme');
  assert.equal(item.status, 'unassigned');
  assert.equal(item.slaDueAt, '2026-01-02T00:00:00.000Z');
  await assert.rejects(() => wf.intake('case1', 'acme'), WorkflowError);
});

test('assign sets owner, notifies, and rejects closed items', async () => {
  const { wf, channel } = engine(['2026-01-01T00:00:00Z', 't1']);
  await wf.intake('case1', 'acme');
  const item = await wf.assign('case1', 'alice');
  assert.equal(item.assignee, 'alice');
  assert.equal(item.status, 'assigned');
  assert.equal(channel.sent.length, 1);
  assert.equal(channel.sent[0]!.to, 'alice');
  wf.close('case1');
  await assert.rejects(() => wf.assign('case1', 'bob'), WorkflowError);
});

test('startReview requires an assignee', async () => {
  const { wf } = engine(['2026-01-01T00:00:00Z']);
  await wf.intake('case1', 'acme');
  assert.throws(() => wf.startReview('case1'), WorkflowError); // unassigned
  await wf.assign('case1', 'alice');
  assert.equal(wf.startReview('case1').status, 'in_review');
});

test('close marks an item closed', async () => {
  const { wf } = engine(['2026-01-01T00:00:00Z']);
  await wf.intake('case1', 'acme');
  assert.equal(wf.close('case1').status, 'closed');
});

test('sweepSla escalates overdue open items and notifies, skipping closed/escalated', async () => {
  // intake at T0 (sla due T0+24h); sweep at T0+48h
  const { wf, channel } = engine([
    '2026-01-01T00:00:00Z', // intake case1
    '2026-01-01T00:00:00Z', // intake case2
    '2026-01-03T00:00:00Z', // sweep (now)
  ]);
  await wf.intake('case1', 'acme');
  await wf.intake('case2', 'globex');
  wf.close('case2'); // closed -> skipped by sweep
  const escalated = await wf.sweepSla();
  assert.equal(escalated.length, 1);
  assert.equal(escalated[0]!.caseId, 'case1');
  assert.equal(escalated[0]!.status, 'escalated');
  assert.equal(channel.sent[channel.sent.length - 1]!.to, 'manager');
  // second sweep: already escalated -> skipped
  const again = await wf.sweepSla();
  assert.equal(again.length, 0);
});

test('sweepSla does not escalate items still within SLA', async () => {
  const { wf } = engine(['2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z']);
  await wf.intake('case1', 'acme');
  const escalated = await wf.sweepSla(); // only 1h elapsed, sla 24h
  assert.equal(escalated.length, 0);
});

test('inbox returns a user owned, non-closed items', async () => {
  const iso = (n: number) => `2026-01-0${n}T00:00:00.000Z`;
  const { wf } = engine([iso(1), iso(1), iso(1), iso(2), iso(2), iso(2), iso(3), iso(3), iso(3), iso(4)]);
  await wf.intake('c1', 'acme');
  await wf.intake('c2', 'acme');
  await wf.intake('c3', 'globex');
  await wf.assign('c1', 'alice');
  await wf.assign('c2', 'alice');
  await wf.assign('c3', 'bob');
  wf.close('c2');
  const inbox = wf.inbox('alice');
  assert.deepEqual(inbox.map((i) => i.caseId), ['c1']); // c2 closed, c3 is bob's
});

test('get returns an item or null; require throws via assign on unknown', async () => {
  const { wf } = engine(['2026-01-01T00:00:00Z']);
  assert.equal(wf.get('missing'), null);
  await assert.rejects(() => wf.assign('missing', 'alice'), WorkflowError);
});

test('default clock stamps ISO timestamps on intake', async () => {
  const channel = new InMemoryChannel('email');
  const wf = new WorkflowEngine(channel, config);
  const item = await wf.intake('case1', 'acme');
  assert.match(item.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});
