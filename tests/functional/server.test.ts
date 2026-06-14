import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApi, resolvePrincipal, serveStatic, dispatch, createApiServer, type ServerDeps } from '../../src/app/server.ts';
import { bootstrap } from '../../src/app/bootstrap.ts';
import { money } from '../../src/money/money.ts';

function clockSeq(start = '2026-04-01T00:00:00.000Z'): () => string {
  let t = Date.parse(start);
  return () => { const iso = new Date(t).toISOString(); t += 1000; return iso; };
}
async function deps(seedCase = true): Promise<ServerDeps> {
  const { app, users } = await bootstrap({ seedCase, clock: clockSeq() });
  return { app, users, webRoot: '/tmp/webroot-none' };
}
function fakeReq(headers: Record<string,string> = { 'x-user-id': 'cfo' }, method = 'GET', url = '/'): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  (req as { headers: Record<string,string> }).headers = headers;
  (req as { method: string }).method = method;
  (req as { url: string }).url = url;
  return req;
}
function fakeReqWithBody(body: unknown, headers: Record<string,string>, method: string, url: string): IncomingMessage {
  const json = Buffer.from(JSON.stringify(body), 'utf8');
  async function* gen() { yield json; }
  const req = gen() as unknown as IncomingMessage;
  (req as { headers: Record<string,string> }).headers = headers;
  (req as { method: string }).method = method;
  (req as { url: string }).url = url;
  return req;
}
function fakeRes(): ServerResponse & { _status: number; _body: string } {
  const res: any = { _status: 0, _body: '', _headers: {} };
  res.writeHead = (status: number, headers?: Record<string, unknown>) => { res._status = status; if (headers) res._headers = headers; return res; };
  res.end = (chunk?: string) => { if (chunk) res._body += chunk; return res; };
  return res as ServerResponse & { _status: number; _body: string };
}
const Q = (s = '') => new URLSearchParams(s);

test('resolvePrincipal (shim) resolves known user, rejects missing/unknown', async () => {
  const d = await deps();
  assert.equal((await resolvePrincipal(d, fakeReq({ 'x-user-id': 'cfo' }))).userId, 'cfo');
  await assert.rejects(() => resolvePrincipal(d, fakeReq({})), /Missing x-user-id/);
  await assert.rejects(() => resolvePrincipal(d, fakeReq({ 'x-user-id': 'ghost' })), /Unknown or inactive/);
});

test('GET /api/health is unauthenticated', async () => {
  const d = await deps();
  const r = await handleApi(d, 'GET', '/api/health', Q(), {}, fakeReq({}));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, tenant: 'northwind-tenant', currency: 'GBP' });
});

test('GET /api/cases, /cases/top, /cases/:id', async () => {
  const d = await deps();
  const list = await handleApi(d, 'GET', '/api/cases', Q(), {}, fakeReq());
  assert.ok(Array.isArray(list.body));
  const top = await handleApi(d, 'GET', '/api/cases/top', Q('limit=2'), {}, fakeReq());
  assert.ok((top.body as unknown[]).length <= 2);
  const cases = list.body as { id: string }[];
  const one = await handleApi(d, 'GET', '/api/cases/' + encodeURIComponent(cases[0]!.id), Q(), {}, fakeReq());
  assert.equal(one.status, 200);
});

test('POST /api/cases creates (201) and validates', async () => {
  const d = await deps(false);
  const body = { customerId: 'acme', findings: [{ id: 'f1', type: 'intent', netRecoverable: money(100_00, 'GBP') }], detectedViaWorkIQ: true, at: '2026-04-02T00:00:00.000Z' };
  const r = await handleApi(d, 'POST', '/api/cases', Q(), body, fakeReq({ 'x-user-id': 'cfo' }, 'POST'));
  assert.equal(r.status, 201);
  await assert.rejects(() => handleApi(d, 'POST', '/api/cases', Q(), { customerId: 5 }, fakeReq({ 'x-user-id': 'cfo' }, 'POST')), /required/);
});

test('POST /api/cases/:id/decision approves and validates', async () => {
  const d = await deps(false);
  const created = await handleApi(d, 'POST', '/api/cases', Q(), { customerId: 'acme', findings: [{ id: 'f', type: 'intent', netRecoverable: money(100_00, 'GBP') }], at: '2026-04-02T00:00:00.000Z' }, fakeReq({ 'x-user-id': 'cfo' }, 'POST'));
  const id = (created.body as { id: string }).id;
  const dec = await handleApi(d, 'POST', '/api/cases/' + id + '/decision', Q(), { decision: 'approve', at: '2026-04-03T00:00:00.000Z' }, fakeReq({ 'x-user-id': 'cfo' }, 'POST'));
  assert.equal(dec.status, 200);
  await assert.rejects(() => handleApi(d, 'POST', '/api/cases/' + id + '/decision', Q(), { decision: 'maybe' }, fakeReq({ 'x-user-id': 'cfo' }, 'POST')), /approve/);
});

test('POST /api/intent/ingest extracts and validates doc', async () => {
  const d = await deps(false);
  const doc = { id: 'd1', customerId: 'northwind', source: 'qbr', capturedAt: '2026-04-01', text: 'agreed 10% uplift', deepLink: 'x' };
  const r = await handleApi(d, 'POST', '/api/intent/ingest', Q(), { doc, minConfidence: 0.5 }, fakeReq({ 'x-user-id': 'cfo' }, 'POST'));
  assert.equal(r.status, 200);
  await assert.rejects(() => handleApi(d, 'POST', '/api/intent/ingest', Q(), {}, fakeReq({ 'x-user-id': 'cfo' }, 'POST')), /doc is required/);
});

test('GET reporting + audit + insights routes', async () => {
  const d = await deps();
  for (const path of ['/api/portfolio', '/api/leakage-by-type', '/api/audit', '/api/total-recoverable', '/api/headline', '/api/anomalies']) {
    const r = await handleApi(d, 'GET', path, Q(), {}, fakeReq());
    assert.equal(r.status, 200, path);
  }
  assert.equal((await handleApi(d, 'GET', '/api/insights', Q('arrMinor=1000000000&windowDays=30'), {}, fakeReq())).status, 200);
  assert.equal((await handleApi(d, 'GET', '/api/insights', Q(), {}, fakeReq())).status, 200);
});

test('GET period-close and evidence-pack require from/to', async () => {
  const d = await deps();
  assert.equal((await handleApi(d, 'GET', '/api/period-close', Q('from=2026-04-01&to=2026-05-31'), {}, fakeReq())).status, 200);
  await assert.rejects(() => handleApi(d, 'GET', '/api/period-close', Q(), {}, fakeReq()), /from and to/);
  assert.equal((await handleApi(d, 'GET', '/api/evidence-pack', Q('from=2026-04-01&to=2026-05-31'), {}, fakeReq())).status, 200);
  await assert.rejects(() => handleApi(d, 'GET', '/api/evidence-pack', Q(), {}, fakeReq()), /from and to/);
});

test('POST /api/roi computes and validates (incl windowDays default)', async () => {
  const d = await deps();
  assert.equal((await handleApi(d, 'POST', '/api/roi', Q(), { annualPlatformCostMinor: 100_000_00, analystHoursSavedPerMonth: 40, analystHourlyCostMinor: 75_00, windowDays: 90 }, fakeReq({ 'x-user-id': 'cfo' }, 'POST'))).status, 200);
  assert.equal((await handleApi(d, 'POST', '/api/roi', Q(), { annualPlatformCostMinor: 1, analystHoursSavedPerMonth: 1, analystHourlyCostMinor: 1 }, fakeReq({ 'x-user-id': 'cfo' }, 'POST'))).status, 200);
  await assert.rejects(() => handleApi(d, 'POST', '/api/roi', Q(), { annualPlatformCostMinor: 'x' }, fakeReq({ 'x-user-id': 'cfo' }, 'POST')), /required/);
});

test('unknown API path returns 404 from handleApi', async () => {
  const d = await deps();
  assert.equal((await handleApi(d, 'GET', '/api/nonexistent', Q(), {}, fakeReq())).status, 404);
});

test('dispatch routes a GET api call and writes JSON', async () => {
  const d = await deps();
  const res = fakeRes();
  await dispatch(d, fakeReq({ 'x-user-id': 'cfo' }, 'GET', '/api/health'), res);
  assert.equal(res._status, 200);
  assert.match(res._body, /"ok":true/);
});

test('dispatch reads a POST body and routes it', async () => {
  const d = await deps(false);
  const res = fakeRes();
  const body = { customerId: 'acme', findings: [{ id: 'f', type: 'intent', netRecoverable: money(100_00, 'GBP') }], at: '2026-04-02T00:00:00.000Z' };
  await dispatch(d, fakeReqWithBody(body, { 'x-user-id': 'cfo' }, 'POST', '/api/cases'), res);
  assert.equal(res._status, 201);
});

test('dispatch maps AppError codes to HTTP statuses', async () => {
  const d = await deps();
  const r403 = fakeRes();
  await dispatch(d, fakeReq({}, 'GET', '/api/cases'), r403);
  assert.equal(r403._status, 403);
  const r404 = fakeRes();
  await dispatch(d, fakeReq({ 'x-user-id': 'cfo' }, 'GET', '/api/cases/ghost'), r404);
  assert.equal(r404._status, 404);
});

test('dispatch surfaces invalid JSON as 400', async () => {
  const d = await deps();
  const res = fakeRes();
  async function* badGen() { yield Buffer.from('{not json', 'utf8'); }
  const req = badGen() as unknown as IncomingMessage;
  (req as { headers: Record<string,string> }).headers = { 'x-user-id': 'cfo' };
  (req as { method: string }).method = 'POST';
  (req as { url: string }).url = '/api/cases';
  await dispatch(d, req, res);
  assert.equal(res._status, 400);
});

test('serveStatic serves file, defaults to index, 404s missing, blocks traversal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rt-web-'));
  await writeFile(join(dir, 'index.html'), '<h1>RevenueTwin</h1>');
  const res1 = fakeRes();
  await serveStatic(dir, '/', res1);
  assert.equal(res1._status, 200);
  assert.match(res1._body, /RevenueTwin/);
  const res2 = fakeRes();
  await serveStatic(dir, '/missing.js', res2);
  assert.equal(res2._status, 404);
  const res3 = fakeRes();
  await serveStatic(dir, '/../../etc/passwd', res3);
  assert.equal(res3._status, 403);
});

test('dispatch falls through to static for non-api paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rt-web2-'));
  await writeFile(join(dir, 'index.html'), 'home');
  const { app, users } = await bootstrap({ seedCase: false, clock: clockSeq() });
  const res = fakeRes();
  await dispatch({ app, users, webRoot: dir }, fakeReq({}, 'GET', '/'), res);
  assert.equal(res._status, 200);
  assert.match(res._body, /home/);
});

test('createApiServer returns a Server instance without listening', async () => {
  const d = await deps(false);
  const server = createApiServer(d);
  assert.equal(typeof server.listen, 'function');
  server.close();
});

test('empty-body POST hits readBody chunks===0 branch', async () => {
  const d = await deps(false);
  const res = fakeRes();
  async function* emptyGen() {}
  const req = emptyGen() as unknown as IncomingMessage;
  (req as { headers: Record<string,string> }).headers = { 'x-user-id': 'cfo' };
  (req as { method: string }).method = 'POST';
  (req as { url: string }).url = '/api/cases';
  await dispatch(d, req, res);
  assert.equal(res._status, 400);
});

test('cases/top without limit uses default', async () => {
  const d = await deps();
  assert.equal((await handleApi(d, 'GET', '/api/cases/top', Q(), {}, fakeReq())).status, 200);
});

test('POST routes use server-side defaults when fields omitted', async () => {
  const d = await deps(false);
  const created = await handleApi(d, 'POST', '/api/cases', Q(), { customerId: 'acme', findings: [{ id: 'f', type: 'intent', netRecoverable: money(100_00, 'GBP') }] }, fakeReq({ 'x-user-id': 'cfo' }, 'POST'));
  assert.equal(created.status, 201);
  const id = (created.body as { id: string }).id;
  assert.equal((await handleApi(d, 'POST', '/api/cases/' + id + '/decision', Q(), { decision: 'approve' }, fakeReq({ 'x-user-id': 'cfo' }, 'POST'))).status, 200);
  assert.equal((await handleApi(d, 'POST', '/api/intent/ingest', Q(), { doc: { id: 'd', customerId: 'acme', source: 'qbr', capturedAt: '2026-04-01', text: 'nothing notable', deepLink: 'x' } }, fakeReq({ 'x-user-id': 'cfo' }, 'POST'))).status, 200);
});

test('serveStatic serves unknown extension as octet-stream', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rt-web3-'));
  await writeFile(join(dir, 'data.bin'), 'binary');
  const res = fakeRes();
  await serveStatic(dir, '/data.bin', res);
  assert.equal(res._status, 200);
});

test('dispatch with missing url/method uses defaults', async () => {
  const d = await deps();
  const res = fakeRes();
  const req = new EventEmitter() as unknown as IncomingMessage;
  (req as { headers: Record<string,string> }).headers = {};
  await dispatch({ ...d, webRoot: '/tmp/none-x' }, req, res);
  assert.ok(res._status === 404 || res._status === 403);
});

test('errorStatus maps a non-AppError throw to 500', async () => {
  const d = await deps(false);
  const res = fakeRes();
  const req = { headers: { 'x-user-id': 'cfo' }, method: 'POST', url: '/api/cases',
    [Symbol.asyncIterator]() { return { next() { throw 'boom-not-an-error'; } }; } } as unknown as IncomingMessage;
  await dispatch(d, req, res);
  assert.equal(res._status, 500);
});

test('dispatch with undefined method on an api path uses GET default', async () => {
  const d = await deps();
  const res = fakeRes();
  const req = new EventEmitter() as unknown as IncomingMessage;
  (req as { headers: Record<string,string> }).headers = { 'x-user-id': 'cfo' };
  (req as { url: string }).url = '/api/health';
  // method intentionally left undefined -> handleApi receives req.method ?? 'GET'
  await dispatch(d, req, res);
  assert.equal(res._status, 200);
});

test('POST /api/import: cfo imports CSV over the handler -> 200 + recoverable total', async () => {
  const d = await deps();
  const csv = ['customer,line_id,type,expected,actual,currency', 'acme,INV-1,price_changed,12000,10800,GBP'].join('\n');
  const r = await handleApi(d, 'POST', '/api/import', Q(), { csv, at: '2026-04-02T00:00:00.000Z' }, fakeReq({ 'x-user-id': 'cfo' }, 'POST'));
  assert.equal(r.status, 200);
  const body = r.body as { totalRecoverable: { amount: number }; cases: unknown[] };
  assert.equal(body.cases.length, 1);
  assert.ok(body.totalRecoverable.amount > 0);
});

test('POST /api/import: missing/empty csv is a 400-class AppError', async () => {
  const d = await deps();
  await assert.rejects(() => handleApi(d, 'POST', '/api/import', Q(), {}, fakeReq({ 'x-user-id': 'cfo' }, 'POST')), /csv .* is required/);
  await assert.rejects(() => handleApi(d, 'POST', '/api/import', Q(), { csv: '' }, fakeReq({ 'x-user-id': 'cfo' }, 'POST')), /csv .* is required/);
});

test('POST /api/import: applies a column mapping for buyer-named headers (S66)', async () => {
  const d = await deps();
  const csv = ['Account,Invoice Number,Category,Expected Amount,Invoice Amount,CCY', 'acme,INV-1,price_changed,12000,10800,GBP'].join('\n');
  const mapping = { Account: 'customer', 'Invoice Number': 'line_id', Category: 'type', 'Expected Amount': 'expected', 'Invoice Amount': 'actual', CCY: 'currency' };
  const r = await handleApi(d, 'POST', '/api/import', Q(), { csv, at: '2026-04-02T00:00:00.000Z', mapping }, fakeReq({ 'x-user-id': 'cfo' }, 'POST'));
  assert.equal(r.status, 200);
  const body = r.body as { cases: unknown[]; totalRecoverable: { amount: number } };
  assert.equal(body.cases.length, 1);
  assert.ok(body.totalRecoverable.amount > 0);
});

test('GET /api/import-template: returns the canonical template CSV', async () => {
  const d = await deps();
  const r = await handleApi(d, 'GET', '/api/import-template', Q(), undefined, fakeReq({ 'x-user-id': 'cfo' }, 'GET'));
  assert.equal(r.status, 200);
  const body = r.body as { template: string };
  assert.ok(body.template.includes('customer,line_id,type'));
  assert.ok(body.template.includes('Acme Corp'));
});

test('GET /api/import-runs + /api/import-runs/:id: list and export a run (S68)', async () => {
  const d = await deps();
  const csv = ['customer,line_id,type,expected,actual,currency', 'acme,INV-1,price_changed,12000,10800,GBP'].join('\n');
  await handleApi(d, 'POST', '/api/import', Q(), { csv, at: '2026-04-02T00:00:00.000Z' }, fakeReq({ 'x-user-id': 'cfo' }, 'POST'));
  const list = await handleApi(d, 'GET', '/api/import-runs', Q(), undefined, fakeReq({ 'x-user-id': 'cfo' }, 'GET'));
  assert.equal(list.status, 200);
  const runs = (list.body as { runs: Array<{ importId: string }> }).runs;
  assert.equal(runs.length, 1);
  const id = runs[0]!.importId;
  const one = await handleApi(d, 'GET', '/api/import-runs/' + encodeURIComponent(id), Q(), undefined, fakeReq({ 'x-user-id': 'cfo' }, 'GET'));
  assert.equal(one.status, 200);
  assert.equal((one.body as { importId: string }).importId, id);
});
