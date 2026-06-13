import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SchedulerError, backoffSeconds, nextDueAt, isDue, JobRunner, dueJobs,
  type JobDefinition,
} from '../../src/scheduler/scheduler.ts';

function def(over: Partial<JobDefinition> = {}): JobDefinition {
  return { id: 'recon', intervalMinutes: 60, maxRetries: 3, backoffBaseSeconds: 2, ...over };
}

function clockSeq(times: string[]): () => string {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)]!;
}

test('backoffSeconds doubles per attempt; rejects attempt < 1', () => {
  const d = def();
  assert.equal(backoffSeconds(d, 1), 2);
  assert.equal(backoffSeconds(d, 2), 4);
  assert.equal(backoffSeconds(d, 3), 8);
  assert.throws(() => backoffSeconds(d, 0), SchedulerError);
});

test('nextDueAt adds the interval; rejects non-positive interval and bad time', () => {
  assert.equal(nextDueAt(def(), '2026-01-01T00:00:00.000Z'), '2026-01-01T01:00:00.000Z');
  assert.throws(() => nextDueAt(def({ intervalMinutes: 0 }), '2026-01-01T00:00:00Z'), SchedulerError);
  assert.throws(() => nextDueAt(def(), 'bad'), SchedulerError);
});

test('isDue: never-run is due; before/after interval', () => {
  assert.equal(isDue(def(), null, '2026-01-01T00:00:00Z'), true);
  assert.equal(isDue(def(), '2026-01-01T00:00:00Z', '2026-01-01T00:30:00Z'), false);
  assert.equal(isDue(def(), '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'), true);
});

test('JobRunner records a success on first try', async () => {
  const runner = new JobRunner(clockSeq(['2026-01-01T00:00:00Z']));
  const records = await runner.run(def(), async () => {});
  assert.equal(records.length, 1);
  assert.equal(records[0]!.outcome, 'success');
  assert.equal(records[0]!.attempt, 0);
});

test('JobRunner retries with backoff then succeeds', async () => {
  const runner = new JobRunner(clockSeq(['2026-01-01T00:00:00.000Z', '2026-01-01T00:05:00.000Z']));
  let calls = 0;
  const records = await runner.run(def(), async () => {
    calls += 1;
    if (calls < 2) throw new Error('transient');
  });
  // attempt 0 fails (with nextRetryAt), attempt 1 succeeds
  assert.equal(records.length, 2);
  assert.equal(records[0]!.outcome, 'failure');
  assert.equal(records[0]!.error, 'transient');
  assert.ok(records[0]!.nextRetryAt);
  assert.equal(records[1]!.outcome, 'success');
});

test('JobRunner exhausts retries and the last failure has no nextRetryAt', async () => {
  const runner = new JobRunner(clockSeq(['2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z', '2026-01-01T00:02:00.000Z']));
  const records = await runner.run(def({ maxRetries: 2 }), async () => { throw new Error('always'); });
  assert.equal(records.length, 3); // attempts 0,1,2
  assert.ok(records[0]!.nextRetryAt);
  assert.ok(records[1]!.nextRetryAt);
  assert.equal(records[2]!.nextRetryAt, undefined); // last attempt, no retry scheduled
  assert.equal(records[2]!.outcome, 'failure');
});

test('JobRunner stringifies non-Error throwables', async () => {
  const runner = new JobRunner(clockSeq(['t0']));
  const records = await runner.run(def({ maxRetries: 0 }), async () => { throw 'string-error'; });
  assert.equal(records[0]!.error, 'string-error');
});

test('JobRunner history filters by jobId', async () => {
  const runner = new JobRunner(clockSeq(['t0', 't1']));
  await runner.run(def({ id: 'a' }), async () => {});
  await runner.run(def({ id: 'b' }), async () => {});
  assert.equal(runner.history().length, 2);
  assert.equal(runner.history('a').length, 1);
});

test('dueJobs selects only due definitions', () => {
  const defs = [def({ id: 'a' }), def({ id: 'b' })];
  const lastRuns = new Map([['a', '2026-01-01T00:00:00Z']]); // b never run
  const due = dueJobs(defs, lastRuns, '2026-01-01T00:30:00Z'); // a not yet due, b due
  assert.deepEqual(due.map((d) => d.id), ['b']);
});

test('JobRunner with default clock produces ISO timestamps', async () => {
  const runner = new JobRunner();
  const records = await runner.run(def(), async () => {});
  assert.match(records[0]!.at, /^\d{4}-\d{2}-\d{2}T/);
});
