import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RevenueTwinApp, AppError } from '../../src/app/application.ts';
import { MemoryUnitOfWork } from '../../src/persistence/memory-adapter.ts';
import { UserStore, AuthzError, principalFromUser } from '../../src/identity/rbac.ts';
import { seedUsers } from '../../src/app/bootstrap.ts';
import { money } from '../../src/money/money.ts';
import type { VarianceFinding } from '../../src/core/model.ts';

function seqClock(start = '2026-04-01T00:00:00.000Z'): () => string {
  let t = Date.parse(start);
  return () => { const iso = new Date(t).toISOString(); t += 1000; return iso; };
}
function app2() {
  const users = seedUsers();
  return { app: new RevenueTwinApp(new MemoryUnitOfWork(), { tenantId: 't1', currency: 'GBP' }, seqClock()), users };
}
function finding(id: string, net: number): VarianceFinding {
  return { id, type: 'intent', netRecoverable: money(net, 'GBP'), confidence: 0.9 };
}

test('auditor cannot open a case (no triage permission) -> forbidden', async () => {
  const { app, users } = app2();
  const auditor = users.authenticate('auditor');
  await assert.rejects(() => app.openCase(auditor, 'acme', [finding('f', 100_00)], false, '2026-04-02T00:00:00.000Z'), (e: unknown) => e instanceof AppError && e.code === 'forbidden');
});

test('revops cannot reject (no case:reject) -> forbidden', async () => {
  const { app, users } = app2();
  const cfo = users.authenticate('cfo');
  const revops = users.authenticate('revops');
  const c = await app.openCase(cfo, 'northwind', [finding('f', 100_00)], false, '2026-04-02T00:00:00.000Z');
  await assert.rejects(() => app.decideCase(revops, c.id, 'reject', '2026-04-03T00:00:00.000Z'), (e: unknown) => e instanceof AppError && e.code === 'forbidden');
});

test('revops cannot read audit trail or run period close (no audit:read)', async () => {
  const { app, users } = app2();
  const revops = users.authenticate('revops');
  await assert.rejects(() => app.auditTrail(revops), (e: unknown) => e instanceof AppError && e.code === 'forbidden');
  await assert.rejects(() => app.periodClose(revops, '2026-04-01', '2026-04-30'), (e: unknown) => e instanceof AppError && e.code === 'forbidden');
});

test('out-of-scope customer access is forbidden, not just empty', async () => {
  const { app, users } = app2();
  const cfo = users.authenticate('cfo');
  const revops = users.authenticate('revops');
  const c = await app.openCase(cfo, 'acme', [finding('f', 100_00)], false, '2026-04-02T00:00:00.000Z');
  await assert.rejects(() => app.getCase(revops, c.id), (e: unknown) => e instanceof AppError && e.code === 'forbidden');
});

test('inactive user cannot authenticate', () => {
  const users = new UserStore();
  users.provision({ id: 'u', email: 'u@x.com', roles: ['cfo'], allowedCustomers: '*', active: false });
  assert.throws(() => users.authenticate('u'), AuthzError);
});

test('user with no roles is rejected', () => {
  assert.throws(() => principalFromUser({ id: 'u', email: 'u@x.com', roles: [], allowedCustomers: '*', active: true }), AuthzError);
});

test('unknown role cannot be resolved into permissions', () => {
  assert.throws(() => principalFromUser({ id: 'u', email: 'u@x.com', roles: ['superadmin' as never], allowedCustomers: '*', active: true }), AuthzError);
});

test('authenticating an unknown user id is rejected', () => {
  const users = seedUsers();
  assert.throws(() => users.authenticate('intruder'), AuthzError);
});

test('scoped principal cannot widen its own scope by passing a different customerId', async () => {
  const { app, users } = app2();
  const cfo = users.authenticate('cfo');
  const revops = users.authenticate('revops');
  // revops is scoped to northwind only; opening for globex must be forbidden regardless of intent
  await assert.rejects(() => app.openCase(revops, 'globex', [finding('f', 100_00)], false, '2026-04-02T00:00:00.000Z'), (e: unknown) => e instanceof AppError && e.code === 'forbidden');
  // and an out-of-scope case stays invisible in its list
  await app.openCase(cfo, 'globex', [finding('g', 100_00)], false, '2026-04-03T00:00:00.000Z');
  const visible = await app.listCases(revops);
  assert.equal(visible.some((c) => c.customerId === 'globex'), false);
});
