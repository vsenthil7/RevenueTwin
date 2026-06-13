import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AuditLog, GENESIS_HASH, hashEntry, AuditError, type AuditEntry,
} from '../../src/core/audit.ts';

function fixedClock(times: string[]): () => string {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)]!;
}

test('first append links to genesis and seals seq 0', () => {
  const log = new AuditLog(fixedClock(['2026-01-01T00:00:00Z']));
  const e = log.append('alice', 'case.created', 'case1', { n: 1 });
  assert.equal(e.seq, 0);
  assert.equal(e.prevHash, GENESIS_HASH);
  assert.equal(e.at, '2026-01-01T00:00:00Z');
  assert.equal(e.hash, hashEntry({ seq: 0, at: e.at, actor: 'alice', event: 'case.created', subject: 'case1', detail: { n: 1 }, prevHash: GENESIS_HASH }));
});

test('subsequent appends chain to previous hash', () => {
  const log = new AuditLog(fixedClock(['t0', 't1', 't2']));
  const a = log.append('alice', 'e1', 's1', {});
  const b = log.append('bob', 'e2', 's2', {});
  const c = log.append('carol', 'e3', 's3', {});
  assert.equal(b.prevHash, a.hash);
  assert.equal(c.prevHash, b.hash);
  assert.equal(c.seq, 2);
});

test('all() returns a defensive copy in order', () => {
  const log = new AuditLog(fixedClock(['t0', 't1']));
  log.append('a', 'e', 's', {});
  log.append('a', 'e', 's', {});
  const snap = log.all();
  assert.equal(snap.length, 2);
  snap.pop();
  assert.equal(log.all().length, 2, 'mutating the copy must not affect the log');
});

test('headHash is genesis when empty, head hash otherwise', () => {
  const log = new AuditLog(fixedClock(['t0']));
  assert.equal(log.headHash(), GENESIS_HASH);
  const e = log.append('a', 'e', 's', {});
  assert.equal(log.headHash(), e.hash);
});

test('length reflects entry count', () => {
  const log = new AuditLog(fixedClock(['t0', 't1']));
  assert.equal(log.length, 0);
  log.append('a', 'e', 's', {});
  assert.equal(log.length, 1);
});

test('verifyChain true for an untampered chain', () => {
  const log = new AuditLog(fixedClock(['t0', 't1', 't2']));
  log.append('a', 'e1', 's1', { v: 1 });
  log.append('a', 'e2', 's2', { v: 2 });
  log.append('a', 'e3', 's3', { v: 3 });
  assert.equal(log.verifyChain(), true);
});

test('verifyChain false when an entry detail is tampered (hash mismatch)', () => {
  const log = new AuditLog(fixedClock(['t0', 't1']));
  log.append('a', 'e1', 's1', { v: 1 });
  log.append('a', 'e2', 's2', { v: 2 });
  // Tamper with the internal array via a cast — simulates storage corruption.
  const entries = log.all() as AuditEntry[];
  const internal = (log as unknown as { entries: AuditEntry[] }).entries;
  internal[0] = { ...entries[0]!, detail: { v: 999 } };
  assert.equal(log.verifyChain(), false);
});

test('verifyChain false when prevHash link is broken', () => {
  const log = new AuditLog(fixedClock(['t0', 't1']));
  log.append('a', 'e1', 's1', {});
  log.append('a', 'e2', 's2', {});
  const internal = (log as unknown as { entries: AuditEntry[] }).entries;
  internal[1] = { ...internal[1]!, prevHash: 'deadbeef'.repeat(8) };
  assert.equal(log.verifyChain(), false);
});

test('verifyChain false when seq is out of order', () => {
  const log = new AuditLog(fixedClock(['t0', 't1']));
  log.append('a', 'e1', 's1', {});
  log.append('a', 'e2', 's2', {});
  const internal = (log as unknown as { entries: AuditEntry[] }).entries;
  internal[1] = { ...internal[1]!, seq: 5 };
  assert.equal(log.verifyChain(), false);
});

test('empty chain verifies vacuously', () => {
  const log = new AuditLog(fixedClock(['t0']));
  assert.equal(log.verifyChain(), true);
});

test('default clock produces an ISO timestamp', () => {
  const log = new AuditLog();
  const e = log.append('a', 'e', 's', {});
  assert.match(e.at, /^\d{4}-\d{2}-\d{2}T/);
});

test('AuditError is constructible', () => {
  const err = new AuditError('boom');
  assert.equal(err.name, 'AuditError');
  assert.equal(err.message, 'boom');
});


test('rehydrate restores a sealed chain so new appends continue from the persisted head', () => {
  const seed = new AuditLog(() => '2026-01-01T00:00:00.000Z');
  seed.append('cfo', 'a', 's1', { n: 1 });
  seed.append('cfo', 'b', 's2', { n: 2 });
  const persisted = seed.all();

  const fresh = new AuditLog(() => '2026-02-01T00:00:00.000Z');
  fresh.rehydrate(persisted);
  assert.equal(fresh.length, 2);
  assert.equal(fresh.headHash(), persisted[1]!.hash);
  // a new append links onto the rehydrated head and the whole chain still verifies
  const next = fresh.append('cfo', 'c', 's3', { n: 3 });
  assert.equal(next.seq, 2);
  assert.equal(next.prevHash, persisted[1]!.hash);
  assert.equal(fresh.verifyChain(), true);
});

test('rehydrate is only valid on an empty chain', () => {
  const log = new AuditLog(() => '2026-01-01T00:00:00.000Z');
  log.append('cfo', 'a', 's1', {});
  assert.throws(() => log.rehydrate([]), /only valid on an empty/);
});

test('rehydrate rejects a non-monotonic seq', () => {
  const seed = new AuditLog(() => '2026-01-01T00:00:00.000Z');
  const e0 = seed.append('cfo', 'a', 's1', {});
  const bad: AuditEntry = { ...e0, seq: 5 };
  // recompute hash so it is the seq check (not the hash check) that fires
  const sealed: AuditEntry = { ...bad, hash: hashEntry({ seq: bad.seq, at: bad.at, actor: bad.actor, event: bad.event, subject: bad.subject, detail: bad.detail, prevHash: bad.prevHash }) };
  assert.throws(() => new AuditLog().rehydrate([sealed]), /non-monotonic seq/);
});

test('rehydrate rejects a prevHash break', () => {
  const seed = new AuditLog(() => '2026-01-01T00:00:00.000Z');
  const e0 = seed.append('cfo', 'a', 's1', {});
  const bad = { ...e0, prevHash: 'f'.repeat(64) };
  const sealed: AuditEntry = { ...bad, hash: hashEntry({ seq: bad.seq, at: bad.at, actor: bad.actor, event: bad.event, subject: bad.subject, detail: bad.detail, prevHash: bad.prevHash }) };
  assert.throws(() => new AuditLog().rehydrate([sealed]), /prevHash break/);
});

test('rehydrate rejects a tampered hash', () => {
  const seed = new AuditLog(() => '2026-01-01T00:00:00.000Z');
  const e0 = seed.append('cfo', 'a', 's1', {});
  const tampered: AuditEntry = { ...e0, hash: '0'.repeat(64) };
  assert.throws(() => new AuditLog().rehydrate([tampered]), /hash mismatch/);
});
