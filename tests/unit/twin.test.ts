import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TwinTimeline, TWIN_TRANSITIONS, canTwinTransition, isTwinTerminal,
  caseStatusToTwinState, TwinError,
} from '../../src/core/twin.ts';
import type { TwinState, CaseStatus } from '../../src/core/model.ts';

function clockSeq(times: string[]): () => string {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)]!;
}

test('canTwinTransition reflects the transition table', () => {
  assert.equal(canTwinTransition('open', 'triaged'), true);
  assert.equal(canTwinTransition('triaged', 'approved'), true);
  assert.equal(canTwinTransition('open', 'recovered'), false);
});

test('isTwinTerminal true only for terminal states', () => {
  const terminal: TwinState[] = ['recovered', 'written_off', 'rejected'];
  for (const s of Object.keys(TWIN_TRANSITIONS) as TwinState[]) {
    assert.equal(isTwinTerminal(s), terminal.includes(s));
  }
});

test('timeline starts open by default', () => {
  const t = new TwinTimeline('cust1');
  assert.equal(t.current, 'open');
  assert.equal(t.terminal, false);
  assert.deepEqual(t.history(), []);
});

test('timeline can start at a provided initial state', () => {
  const t = new TwinTimeline('cust1', clockSeq(['t0']), 'approved');
  assert.equal(t.current, 'approved');
  assert.deepEqual(t.nextStates().sort(), ['in_dispute', 'partially_recovered', 'recovered', 'written_off']);
});

test('legal transition records history and advances state', () => {
  const t = new TwinTimeline('cust1', clockSeq(['2026-01-01', '2026-01-02']));
  const tr = t.transition('triaged', 'alice', 'initial triage');
  assert.equal(t.current, 'triaged');
  assert.equal(tr.from, 'open');
  assert.equal(tr.to, 'triaged');
  assert.equal(tr.at, '2026-01-01');
  assert.equal(tr.actor, 'alice');
  assert.equal(tr.reason, 'initial triage');
  assert.equal(t.history().length, 1);
});

test('transition without reason omits the field', () => {
  const t = new TwinTimeline('cust1', clockSeq(['t0']));
  const tr = t.transition('triaged', 'alice');
  assert.equal(tr.reason, undefined);
  assert.equal('reason' in tr, false);
});

test('illegal transition throws TwinError and does not advance', () => {
  const t = new TwinTimeline('cust1', clockSeq(['t0']));
  assert.throws(() => t.transition('recovered', 'alice'), TwinError);
  assert.equal(t.current, 'open');
  assert.equal(t.history().length, 0);
});

test('full lifecycle to recovered is terminal', () => {
  const t = new TwinTimeline('cust1', clockSeq(['a', 'b', 'c', 'd']));
  t.transition('triaged', 'a');
  t.transition('approved', 'a');
  t.transition('partially_recovered', 'a');
  t.transition('recovered', 'a');
  assert.equal(t.current, 'recovered');
  assert.equal(t.terminal, true);
  assert.deepEqual(t.nextStates(), []);
  assert.equal(t.history().length, 4);
});

test('history returns a defensive copy', () => {
  const t = new TwinTimeline('cust1', clockSeq(['t0']));
  t.transition('triaged', 'a');
  const h = t.history();
  h.pop();
  assert.equal(t.history().length, 1);
});

test('caseStatusToTwinState collapses operational states onto triaged', () => {
  assert.equal(caseStatusToTwinState('in_review'), 'triaged');
  assert.equal(caseStatusToTwinState('escalated'), 'triaged');
});

test('caseStatusToTwinState maps the rest 1:1', () => {
  const direct: CaseStatus[] = ['open', 'approved', 'rejected', 'in_dispute', 'partially_recovered', 'recovered', 'written_off'];
  for (const s of direct) {
    assert.equal(caseStatusToTwinState(s), s);
  }
});

test('default clock yields ISO timestamps', () => {
  const t = new TwinTimeline('cust1');
  const tr = t.transition('triaged', 'a');
  assert.match(tr.at, /^\d{4}-\d{2}-\d{2}T/);
});
