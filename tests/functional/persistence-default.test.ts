import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBackend, selectUnitOfWork } from '../../src/app/persistence-factory.ts';
import type { PgClient } from '../../src/persistence/postgres-adapter.ts';
import { bootstrap } from '../../src/app/bootstrap.ts';
import { MemoryUnitOfWork } from '../../src/persistence/memory-adapter.ts';

function seqClock(start = '2026-04-01T00:00:00.000Z'): () => string {
  let t = Date.parse(start);
  return () => { const iso = new Date(t).toISOString(); t += 1000; return iso; };
}
// Fake PgClient: records queries, returns empty result sets. Enough to prove wiring without a DB.
function fakePg(): PgClient & { calls: string[] } {
  const calls: string[] = [];
  return { calls, async query(text: string) { calls.push(text.split('\\n')[0]!.trim().slice(0, 40)); return { rows: [], rowCount: 0 }; } };
}

test('resolveBackend: DATABASE_URL implies postgres', () => {
  assert.equal(resolveBackend({ databaseUrl: 'postgres://x' }), 'postgres');
});

test('resolveBackend: no url implies memory', () => {
  assert.equal(resolveBackend({}), 'memory');
  assert.equal(resolveBackend({ databaseUrl: '' }), 'memory');
});

test('resolveBackend: explicit backend overrides url', () => {
  assert.equal(resolveBackend({ backend: 'memory', databaseUrl: 'postgres://x' }), 'memory');
  assert.equal(resolveBackend({ backend: 'postgres' }), 'postgres');
});

test('resolveBackend: forceMemory wins over everything', () => {
  assert.equal(resolveBackend({ forceMemory: true, backend: 'postgres', databaseUrl: 'postgres://x' }), 'memory');
});

test('selectUnitOfWork: memory backend returns a MemoryUnitOfWork', () => {
  const { uow, backend } = selectUnitOfWork({ tenantId: 't' });
  assert.equal(backend, 'memory');
  assert.ok(uow instanceof MemoryUnitOfWork);
});

test('selectUnitOfWork: postgres backend builds a Postgres UoW from the injected factory', async () => {
  const pg = fakePg();
  const { uow, backend } = selectUnitOfWork({ tenantId: 't', databaseUrl: 'postgres://db', pgClientFactory: () => pg });
  assert.equal(backend, 'postgres');
  // exercise the transaction wrapper so BEGIN/COMMIT route to the client
  await uow.transaction(async () => {});
  assert.ok(pg.calls.includes('BEGIN'));
  assert.ok(pg.calls.includes('COMMIT'));
});

test('selectUnitOfWork: postgres without url throws (fail fast, no silent memory fallback)', () => {
  assert.throws(() => selectUnitOfWork({ tenantId: 't', backend: 'postgres' }), /no databaseUrl/);
});

test('selectUnitOfWork: postgres without a client factory throws', () => {
  assert.throws(() => selectUnitOfWork({ tenantId: 't', databaseUrl: 'postgres://db' }), /no pgClientFactory/);
});

test('bootstrap defaults to memory when no DATABASE_URL', async () => {
  const { backend, uow } = await bootstrap({ seedCase: false, clock: seqClock() });
  assert.equal(backend, 'memory');
  assert.ok(uow instanceof MemoryUnitOfWork);
});

test('bootstrap selects postgres when databaseUrl + factory provided (seedCase off)', async () => {
  const pg = fakePg();
  const { backend } = await bootstrap({ seedCase: false, databaseUrl: 'postgres://db', pgClientFactory: () => pg, clock: seqClock() });
  assert.equal(backend, 'postgres');
});

test('bootstrap forceMemory ignores a DATABASE_URL (demo/test override)', async () => {
  const { backend } = await bootstrap({ seedCase: false, databaseUrl: 'postgres://db', forceMemory: true, clock: seqClock() });
  assert.equal(backend, 'memory');
});

test('bootstrap with an explicit uow still wins and reports memory', async () => {
  const uow = new MemoryUnitOfWork();
  const res = await bootstrap({ uow, seedCase: false, databaseUrl: 'postgres://db', clock: seqClock() });
  assert.equal(res.uow, uow);
  assert.equal(res.backend, 'memory');
});
