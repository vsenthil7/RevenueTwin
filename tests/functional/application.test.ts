import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RevenueTwinApp } from '../../src/app/application.ts';
import { bootstrap, seedUsers, northwindFindings } from '../../src/app/bootstrap.ts';
import { MemoryUnitOfWork } from '../../src/persistence/memory-adapter.ts';
import { UserStore } from '../../src/identity/rbac.ts';
import { money } from '../../src/money/money.ts';
import type { VarianceFinding } from '../../src/core/model.ts';
import type { IntentExtractor, IntentDocument } from '../../src/intent/extraction.ts';

function clockSeq(start = '2026-04-01T00:00:00.000Z'): () => string {
  let t = Date.parse(start);
  return () => { const iso = new Date(t).toISOString(); t += 1000; return iso; };
}
function freshApp() {
  const users = seedUsers();
  const app = new RevenueTwinApp(new MemoryUnitOfWork(), { tenantId: 't1', currency: 'GBP' }, clockSeq());
  return { app, users };
}
function finding(id: string, net: number): VarianceFinding {
  return { id, type: 'intent', netRecoverable: money(net, 'GBP'), confidence: 0.9 };
}
async function seededApp(): Promise<{ app: RevenueTwinApp; users: UserStore }> {
  const { app, users } = await bootstrap({ clock: clockSeq() });
  return { app, users };
}
const stubExtractor: IntentExtractor = {
  async extract(doc) {
    return doc.text.includes('uplift')
      ? { intentType: 'uplift', upliftPercent: 10, confidence: 0.92, extractedSpan: 'agreed 10% uplift' }
      : null;
  },
};

test('GOLDEN THREAD: open -> approve -> audit through the app', async () => {
  const { app, users } = freshApp();
  const cfo = users.authenticate('cfo');
  const findings = northwindFindings(true);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.netRecoverable.amount, 120_000);
  const opened = await app.openCase(cfo, 'northwind', findings, true, '2026-04-02T00:00:00.000Z');
  assert.equal(opened.status, 'open');
  assert.equal(opened.detectedViaWorkIQ, true);
  const approved = await app.decideCase(cfo, opened.id, 'approve', '2026-04-03T00:00:00.000Z');
  assert.equal(approved.status, 'approved');
  const trail = await app.auditTrail(cfo);
  assert.ok(trail.some((e) => e.event === 'case.created'));
  assert.ok(trail.some((e) => e.event === 'case.approve'));
  assert.equal(await app.auditIntact(cfo), true);
});

test('blind vs sighted: OFF yields no finding, ON yields the leak', () => {
  assert.equal(northwindFindings(false).length, 0);
  assert.equal(northwindFindings(true).length, 1);
});

test('reject path transitions to rejected', async () => {
  const { app, users } = freshApp();
  const cfo = users.authenticate('cfo');
  const c = await app.openCase(cfo, 'acme', [finding('f1', 500_00)], false, '2026-04-02T00:00:00.000Z');
  const rejected = await app.decideCase(cfo, c.id, 'reject', '2026-04-03T00:00:00.000Z');
  assert.equal(rejected.status, 'rejected');
});

test('decideCase refuses a non-actionable case', async () => {
  const { app, users } = freshApp();
  const cfo = users.authenticate('cfo');
  const c = await app.openCase(cfo, 'acme', [finding('f1', 500_00)], false, '2026-04-02T00:00:00.000Z');
  await app.decideCase(cfo, c.id, 'approve', '2026-04-03T00:00:00.000Z');
  await assert.rejects(() => app.decideCase(cfo, c.id, 'approve', '2026-04-04T00:00:00.000Z'), /not actionable/);
});

test('openCase requires a finding; getCase 404s when missing', async () => {
  const { app, users } = freshApp();
  const cfo = users.authenticate('cfo');
  await assert.rejects(() => app.openCase(cfo, 'acme', [], false, '2026-04-02T00:00:00.000Z'), /finding/);
  await assert.rejects(() => app.getCase(cfo, 'nope'), /not found/);
});

test('listCases and queryCases are scoped, sorted, paged', async () => {
  const { app, users } = freshApp();
  const cfo = users.authenticate('cfo');
  await app.openCase(cfo, 'acme', [finding('a', 100_00)], false, '2026-04-02T00:00:00.000Z');
  await app.openCase(cfo, 'globex', [finding('b', 900_00)], false, '2026-04-03T00:00:00.000Z');
  assert.equal((await app.listCases(cfo)).length, 2);
  const page = await app.queryCases(cfo, { sort: { key: 'netRecoverable', dir: 'desc' }, page: 1, pageSize: 1 });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]!.customerId, 'globex');
  assert.equal(page.total, 2);
});

test('ingestIntent extracts a confident event and audits it', async () => {
  const { app, users } = freshApp();
  const cfo = users.authenticate('cfo');
  const doc: IntentDocument = { id: 'd1', customerId: 'acme', source: 'qbr', capturedAt: '2026-04-01', text: 'agreed 10% uplift', deepLink: 'x' };
  const ev = await app.ingestIntent(cfo, stubExtractor, doc);
  assert.ok(ev);
  assert.equal(ev!.upliftPercent, 10);
  assert.ok((await app.auditTrail(cfo)).some((e) => e.event === 'intent.extracted'));
});

test('ingestIntent returns null below confidence and does not audit', async () => {
  const { app, users } = freshApp();
  const cfo = users.authenticate('cfo');
  const doc: IntentDocument = { id: 'd1', customerId: 'acme', source: 'email', capturedAt: '2026-04-01', text: 'no signal', deepLink: 'x' };
  assert.equal(await app.ingestIntent(cfo, stubExtractor, doc), null);
  assert.equal((await app.auditTrail(cfo)).length, 0);
});

test('portfolioSummary, leakageByType, periodClose', async () => {
  const { app, users } = freshApp();
  const cfo = users.authenticate('cfo');
  await app.openCase(cfo, 'acme', [finding('a', 300_00)], true, '2026-04-02T00:00:00.000Z');
  await app.openCase(cfo, 'globex', [{ id: 'b', type: 'tax', netRecoverable: money(200_00, 'GBP') }], false, '2026-04-05T00:00:00.000Z');
  const s = await app.portfolioSummary(cfo);
  assert.equal(s.totalCases, 2);
  assert.equal(s.totalRecoverable.amount, 500_00);
  assert.equal(s.workIQAttributable.amount, 300_00);
  const byType = await app.leakageByType(cfo);
  assert.ok(byType.some((b) => b.type === 'intent') && byType.some((b) => b.type === 'tax'));
  const pack = await app.periodClose(cfo, '2026-04-01', '2026-04-30');
  assert.equal(pack.caseIds.length, 2);
});

test('totalRecoverable and topCases rank the portfolio', async () => {
  const { app, users } = freshApp();
  const cfo = users.authenticate('cfo');
  await app.openCase(cfo, 'acme', [finding('a', 100_00)], false, '2026-04-02T00:00:00.000Z');
  await app.openCase(cfo, 'globex', [finding('b', 900_00)], false, '2026-04-03T00:00:00.000Z');
  assert.equal((await app.totalRecoverable(cfo)).amount, 1000_00);
  assert.equal((await app.topCases(cfo, 1))[0]!.customerId, 'globex');
});

test('headline, insights, roi, anomalies, evidencePack run end-to-end', async () => {
  const { app, users } = await seededApp();
  const cfo = users.authenticate('cfo');
  const h = await app.headline(cfo);
  assert.ok(h.caseCount >= 6);
  assert.equal(h.currency, 'GBP');
  assert.ok(h.workIQShare > 0);
  const ins = await app.insights(cfo, { windowDays: 90, arrMinor: 10_000_000_00, industry: 'saas', historicalRecoveryRate: 0.6 });
  assert.equal(ins.runRate.isForecast, true);
  assert.ok(ins.totalRecoverable.amount > 0);
  const roi = await app.roi(cfo, { annualPlatformCostMinor: 100_000_00, analystHoursSavedPerMonth: 40, analystHourlyCostMinor: 75_00 });
  assert.ok(roi.totalAnnualBenefit.amount > 0);
  assert.ok(roi.roiMultiple > 0);
  assert.ok(Array.isArray(await app.anomalies(cfo)));
  const pack = await app.evidencePack(cfo, '2026-04-01', '2026-05-31', '2026-06-01T00:00:00.000Z');
  assert.equal(pack.controls.length, 3);
  assert.equal(pack.contentHash.length, 64);
});

test('insights uses defaults when opts omitted', async () => {
  const { app, users } = await seededApp();
  const ins = await app.insights(users.authenticate('cfo'));
  assert.equal(ins.benchmark.industry, 'saas');
});

test('headline and insights handle an empty portfolio', async () => {
  const { app, users } = freshApp();
  const cfo = users.authenticate('cfo');
  const h = await app.headline(cfo);
  assert.equal(h.caseCount, 0);
  assert.equal(h.workIQShare, 0);
  const ins = await app.insights(cfo, { arrMinor: 1_000_000_00 });
  assert.equal(ins.totalRecoverable.amount, 0);
  assert.equal(ins.recoveryMaturity, 'nascent');
});

test('bootstrap seeds Northwind + structural portfolio; seedCase=false empty; custom tenant', async () => {
  const { app, users } = await bootstrap({ clock: clockSeq() });
  const cfo = users.authenticate('cfo');
  const cases = await app.listCases(cfo);
  assert.ok(cases.length >= 6);
  assert.ok(cases.some((c) => c.customerId === 'northwind' && c.detectedViaWorkIQ));
  assert.equal(await app.auditIntact(cfo), true);
  const empty = await bootstrap({ seedCase: false, clock: clockSeq() });
  assert.equal((await empty.app.listCases(empty.users.authenticate('cfo'))).length, 0);
  const custom = await bootstrap({ uow: new MemoryUnitOfWork(), tenantId: 'custom', currency: 'USD', seedCase: false, clock: clockSeq() });
  assert.equal(custom.app.tenantId, 'custom');
  assert.equal(custom.app.currency, 'USD');
});

test('app.close releases resources; default clock stamps ISO', async () => {
  const { app } = freshApp();
  await app.close();
  const app2 = new RevenueTwinApp(new MemoryUnitOfWork(), { tenantId: 't', currency: 'GBP' });
  const cfo = seedUsers().authenticate('cfo');
  await app2.openCase(cfo, 'acme', [finding('f', 100_00)], false, '2026-04-02T00:00:00.000Z');
  assert.match((await app2.auditTrail(cfo))[0]!.at, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T/);
});

test('permission denied: revops cannot approve', async () => {
  const { app, users } = freshApp();
  const cfo = users.authenticate('cfo');
  const revops = users.authenticate('revops');
  const c = await app.openCase(cfo, 'northwind', [finding('f', 100_00)], false, '2026-04-02T00:00:00.000Z');
  await assert.rejects(() => app.decideCase(revops, c.id, 'approve', '2026-04-03T00:00:00.000Z'), /permission/);
});

test('permission denied: a no-read principal cannot read cases', async () => {
  const { app } = freshApp();
  const noRead = { userId: 'x', roles: [], permissions: new Set<never>(), allowedCustomers: '*' as const };
  await assert.rejects(() => app.listCases(noRead), /permission/);
});

test('customer scope denied on openCase, getCase, ingestIntent; listCases filters', async () => {
  const { app, users } = freshApp();
  const cfo = users.authenticate('cfo');
  const revops = users.authenticate('revops');
  await assert.rejects(() => app.openCase(revops, 'acme', [finding('f', 100_00)], false, '2026-04-02T00:00:00.000Z'), /out of scope/);
  const c = await app.openCase(cfo, 'acme', [finding('f', 100_00)], false, '2026-04-02T00:00:00.000Z');
  await assert.rejects(() => app.getCase(revops, c.id), /out of scope/);
  const doc: IntentDocument = { id: 'd', customerId: 'acme', source: 'qbr', capturedAt: '2026-04-01', text: 'agreed 10% uplift', deepLink: 'x' };
  await assert.rejects(() => app.ingestIntent(revops, stubExtractor, doc), /out of scope/);
  await app.openCase(cfo, 'northwind', [finding('n', 100_00)], false, '2026-04-03T00:00:00.000Z');
  assert.deepEqual((await app.listCases(revops)).map((x) => x.customerId), ['northwind']);
});

test('ROI handles zero cost (multiple 0) and zero benefit (payback Infinity)', async () => {
  const { app, users } = freshApp();
  const cfo = users.authenticate('cfo');
  const zb = await app.roi(cfo, { annualPlatformCostMinor: 100_00, analystHoursSavedPerMonth: 0, analystHourlyCostMinor: 0 });
  assert.equal(zb.paybackMonths, Infinity);
  const zc = await app.roi(cfo, { annualPlatformCostMinor: 0, analystHoursSavedPerMonth: 10, analystHourlyCostMinor: 50_00 });
  assert.equal(zc.roiMultiple, 0);
});


test('init() rehydrates the audit chain from a populated store so a fresh app continues it', async () => {
  const uow = new MemoryUnitOfWork();
  const users = seedUsers();
  const cfo = users.authenticate('cfo');
  // First app instance writes a couple of audited events into the shared store.
  const app1 = new RevenueTwinApp(uow, { tenantId: 't', currency: 'GBP' }, clockSeq());
  await app1.openCase(cfo, 'acme', [{ id: 'f1', type: 'intent', netRecoverable: money(1000_00, 'GBP') }], false, '2026-04-02T00:00:00.000Z');
  const before = (await uow.audit.all()).length;
  assert.ok(before > 0);

  // A fresh app on the SAME store must rehydrate, not restart at genesis.
  const app2 = new RevenueTwinApp(uow, { tenantId: 't', currency: 'GBP' }, clockSeq('2026-05-01T00:00:00.000Z'));
  await app2.init();
  // A new decision appends onto the rehydrated head; the persisted chain stays intact.
  const cases = await app2.listCases(cfo);
  await app2.decideCase(cfo, cases[0]!.id, 'approve', '2026-05-01T01:00:00.000Z');
  assert.equal(await app2.auditIntact(cfo), true);
  assert.equal((await uow.audit.all()).length, before + 1);
});

test('init() on an empty store is a no-op', async () => {
  const uow = new MemoryUnitOfWork();
  const app = new RevenueTwinApp(uow, { tenantId: 't', currency: 'GBP' }, clockSeq());
  await app.init();
  const cfo = seedUsers().authenticate('cfo');
  assert.equal(await app.auditIntact(cfo), true);
});
