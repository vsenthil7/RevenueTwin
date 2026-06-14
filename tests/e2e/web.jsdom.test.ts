import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { mapCase, authHeaders, createClient, probe } from '../../web/api.js';
import * as app from '../../web/app.js';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '../../web');
const html = readFileSync(resolve(webDir, 'index.html'), 'utf8');

function dom(): Document {
  const j = new JSDOM(html);
  return j.window.document;
}
// a fetch fake that returns JSON bodies keyed by path suffix
function fakeFetch(routes: Record<string, unknown>, opts: { failHealth?: boolean } = {}) {
  return async (url: string) => {
    const i = url.indexOf('/api/'); const path = i >= 0 ? url.slice(i) : url;
    if (path.endsWith('/api/health') && opts.failHealth) return { ok: false, status: 503, json: async () => ({}) };
    const key = Object.keys(routes).find((k) => path.endsWith(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => routes[key] };
  };
}

test('mapCase maps a Work IQ backend case incl provenance', () => {
  const backend = { id: 'c1', customerId: 'northwind', status: 'open', detectedViaWorkIQ: true,
    findings: [{ type: 'intent', netRecoverable: { amount: 120000 }, grossDetected: { amount: 120000 }, confidence: 0.88, extractedSpan: '12% uplift', deepLink: 'teams://x' }] };
  const m = mapCase(backend);
  assert.equal(m.netRecoverable, 120000);
  assert.equal(m.grossDetected, 120000);
  assert.equal(m.detectedViaWorkIQ, true);
  assert.equal(m.provenance.span, '12% uplift');
  assert.equal(m.provenance.deepLink, 'teams://x');
});

test('mapCase handles a structural case with no findings/provenance', () => {
  const m = mapCase({ id: 'c2', customerId: 'acme', status: 'open', detectedViaWorkIQ: false, findings: [] });
  assert.equal(m.netRecoverable, 0);
  assert.equal(m.type, 'unknown');
  assert.equal(m.confidence, 0);
  assert.equal(m.provenance, undefined);
});

test('mapCase falls back to default span/deepLink when missing', () => {
  const m = mapCase({ id: 'c3', customerId: 'x', status: 'open', detectedViaWorkIQ: true, findings: [{ type: 'intent', netRecoverable: { amount: 1 }, grossDetected: { amount: 1 } }] });
  assert.ok(m.provenance.span.length > 0);
  assert.equal(m.provenance.deepLink, '#');
});

test('authHeaders sets the user id and content type', () => {
  const h = authHeaders('cfo');
  assert.equal(h['x-user-id'], 'cfo');
  assert.equal(h['Content-Type'], 'application/json');
});

test('createClient GET/POST hit the right routes', async () => {
  const calls: string[] = [];
  const f = async (url: string, init?: any) => { calls.push((init && init.method || 'GET') + ' ' + url); return { ok: true, status: 200, json: async () => ({ url }) }; };
  const client = createClient('http://api', 'cfo', f as any);
  await client.health();
  await client.cases();
  await client.roi({ annualPlatformCostMinor: 1 });
  await client.decide('case 1', 'approve');
  assert.ok(calls.includes('GET http://api/api/health'));
  assert.ok(calls.includes('GET http://api/api/cases'));
  assert.ok(calls.some((c) => c.startsWith('POST http://api/api/roi')));
  assert.ok(calls.some((c) => c.indexOf('/api/cases/case%201/decision') >= 0));
});

test('createClient throws on a non-ok response', async () => {
  const f = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const client = createClient('http://api', 'cfo', f as any);
  await assert.rejects(() => client.cases(), /-> 500/);
});

test('probe returns true when health is ok, false when it throws or fails', async () => {
  assert.equal(await probe('http://api', (async () => ({ ok: true })) as any), true);
  assert.equal(await probe('http://api', (async () => ({ ok: false })) as any), false);
  assert.equal(await probe('http://api', (async () => { throw new Error('down'); }) as any), false);
  assert.equal(await probe('http://api', null as any), false);
});

test('fmtGBP formats minor units as GBP', () => {
  assert.equal(app.fmtGBP(120000), '£1,200.00');
  assert.equal(app.fmtGBP(0), '£0.00');
});

test('visibleCases hides the intent case when Work IQ is off', () => {
  const on = app.visibleCases(true);
  const off = app.visibleCases(false);
  assert.equal(on.length, 3);
  assert.equal(off.length, 2);
  assert.ok(on.some((c: any) => c.detectedViaWorkIQ));
  assert.ok(!off.some((c: any) => c.detectedViaWorkIQ));
  // sorted by net recoverable desc
  assert.ok(on[0].netRecoverable >= on[1].netRecoverable);
});

test('recallState encodes blind-vs-sighted recall', () => {
  assert.deepEqual(app.recallState(true), { off: 0, on: 1, active: 'on' });
  assert.deepEqual(app.recallState(false), { off: 0, on: 1, active: 'off' });
});

test('caseCardHTML marks Work IQ and active cases', () => {
  const wq = app.caseCardHTML({ id: 'a', customer: 'X', type: 'intent', netRecoverable: 100, confidence: 0.9, detectedViaWorkIQ: true }, 'a');
  assert.ok(wq.includes('workiq'));
  assert.ok(wq.includes('active'));
  assert.ok(wq.includes('WORK IQ'));
  const st = app.caseCardHTML({ id: 'b', customer: 'Y', type: 'missed_escalator', netRecoverable: 50, confidence: 0.8, detectedViaWorkIQ: false }, 'a');
  assert.ok(st.includes('missed escalator'));
  assert.ok(!st.includes('active'));
});

test('dashboardHTML renders hero stats, forecast, roi and leakage rows', () => {
  const out = app.dashboardHTML({
    headline: { totalRecoverableMajor: 1840, caseCount: 3, workIQShare: 0.65 },
    insights: { runRate: { annualized: { amount: 500000 } }, projection: { expectedRecovered: { amount: 110400 } }, benchmark: { quartile: 'top' }, recoveryMaturity: 'leading' },
    leakageByType: [{ type: 'intent_uplift', cases: 1, recoverable: { amount: 120000 } }],
    roi: { totalAnnualBenefit: { amount: 200000 }, netAnnualValue: { amount: 100000 }, roiMultiple: 3, paybackMonths: 4 },
  });
  assert.ok(out.includes('dash-total'));
  assert.ok(out.includes('£1,840.00'));
  assert.ok(out.includes('65%'));
  assert.ok(out.includes('intent uplift'));
  assert.ok(out.includes('3×'));
});

test('dashboardHTML tolerates missing sections (defaults to zeros)', () => {
  const out = app.dashboardHTML({});
  assert.ok(out.includes('£0.00'));
  assert.ok(out.includes('CFO Dashboard'));
});

test('mount renders the queue into index.html and reacts to clicks', () => {
  const doc = dom();
  const ctrl = app.mount(doc);
  const cards = doc.querySelectorAll('[data-case-id]');
  assert.equal(cards.length, 3); // Work IQ on by default
  // click the first card -> inspector populates and case becomes active
  (cards[0] as any).dispatchEvent(new doc.defaultView!.Event('click'));
  assert.ok(ctrl.state.activeId);
  const inspector = doc.querySelector('[data-testid="inspector"]')!;
  assert.ok(inspector.innerHTML.length > 0);
});

test('mount toggle hides the Work IQ case and clears it if active', () => {
  const doc = dom();
  const ctrl = app.mount(doc);
  // activate the Work IQ (intent) case — it is first when sorted (120000)
  const wqCard = doc.querySelector('.case-card.workiq [data-case-id], .case-card.workiq')!;
  // find the intent card id via state model instead of DOM ambiguity
  const intentId = app.visibleCases(true).find((c: any) => c.detectedViaWorkIQ).id;
  ctrl.state.activeId = intentId; ctrl.render();
  // turn Work IQ off
  const toggle = doc.querySelector('[data-testid="workiq-toggle"]') as any;
  toggle.checked = false;
  toggle.dispatchEvent(new doc.defaultView!.Event('change'));
  // intent card is gone and active cleared
  assert.equal(doc.querySelectorAll('[data-case-id]').length, 2);
  assert.equal(ctrl.state.activeId, null);
  const mode = doc.querySelector('[data-testid="mode-pill"]')!;
  assert.ok(mode.textContent!.includes('Work IQ disabled'));
});

test('mountLive falls back to fixtures when the API is unreachable', async () => {
  const doc = dom();
  const api = { createClient, probe, mapCase };
  await app.mountLive(doc, { api, baseUrl: 'http://down', fetchImpl: (async () => { throw new Error('no net'); }) as any });
  const mode = doc.querySelector('[data-testid="mode-pill"]')!;
  assert.ok(mode.textContent!.includes('DEMO'));
  assert.equal(doc.querySelectorAll('[data-case-id]').length, 3);
});

test('mountLive hydrates from the API when reachable', async () => {
  const doc = dom();
  const routes = {
    '/api/health': { ok: true },
    '/api/cases': [
      { id: 'c1', customerId: 'northwind', status: 'open', detectedViaWorkIQ: true, findings: [{ type: 'intent', netRecoverable: { amount: 120000 }, grossDetected: { amount: 120000 }, confidence: 0.9, extractedSpan: 's', deepLink: '#' }] },
      { id: 'c2', customerId: 'acme', status: 'open', detectedViaWorkIQ: false, findings: [{ type: 'missed_escalator', netRecoverable: { amount: 36000 }, grossDetected: { amount: 45000 }, confidence: 0.95 }] },
    ],
  };
  const api = { createClient, probe, mapCase };
  await app.mountLive(doc, { api, baseUrl: 'http://api', fetchImpl: fakeFetch(routes) as any });
  const mode = doc.querySelector('[data-testid="mode-pill"]')!;
  assert.ok(mode.textContent!.includes('LIVE'));
  assert.equal(doc.querySelectorAll('[data-case-id]').length, 2);
});

test('mountLive live interactions: card click, dashboard tab, approve decision', async () => {
  const doc = dom();
  const decided: string[] = [];
  const routes = {
    '/api/health': { ok: true },
    '/api/cases': [
      { id: 'c1', customerId: 'northwind', status: 'open', detectedViaWorkIQ: true, findings: [{ type: 'intent', netRecoverable: { amount: 120000 }, grossDetected: { amount: 120000 }, confidence: 0.9, extractedSpan: 's', deepLink: '#' }] },
    ],
    '/api/headline': { totalRecoverableMajor: 1200, caseCount: 1, workIQShare: 1 },
    '/api/insights': { runRate: { annualized: { amount: 1 } }, projection: { expectedRecovered: { amount: 1 } }, benchmark: { quartile: 'top' }, recoveryMaturity: 'leading' },
    '/api/leakage-by-type': [{ type: 'intent', cases: 1, recoverable: { amount: 120000 } }],
    '/api/roi': { totalAnnualBenefit: { amount: 1 }, netAnnualValue: { amount: 1 }, roiMultiple: 1, paybackMonths: 1 },
  };
  const f = (url: string, init?: any) => {
    if (init && init.method === 'POST' && url.indexOf('/decision') >= 0) { decided.push(url); return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'approved' }) }); }
    return (fakeFetch(routes) as any)(url);
  };
  const api = { createClient, probe, mapCase };
  await app.mountLive(doc, { api, baseUrl: 'http://api', fetchImpl: f as any });
  const Event = doc.defaultView!.Event;
  // click the case card -> inspector renders approve/reject
  (doc.querySelector('[data-case-id]') as any).dispatchEvent(new Event('click'));
  const approve = doc.querySelector('[data-testid="approve-btn"]');
  assert.ok(approve, 'approve button should render after selecting a case');
  (approve as any).dispatchEvent(new Event('click'));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(decided.some((u) => u.indexOf('/decision') >= 0), 'a decision should be POSTed');
  // switch to dashboard tab -> loads + renders dashboard
  (doc.querySelector('[data-testid="tab-dashboard"]') as any).dispatchEvent(new Event('click'));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(doc.querySelector('[data-testid="inspector-body"]')!.innerHTML.indexOf('CFO Dashboard') >= 0);
  // back to triage
  (doc.querySelector('[data-testid="tab-triage"]') as any).dispatchEvent(new Event('click'));
});

test('mountLive reject decision path posts a reject', async () => {
  const doc = dom();
  const decided: any[] = [];
  const routes = { '/api/health': { ok: true }, '/api/cases': [ { id: 'c1', customerId: 'x', status: 'open', detectedViaWorkIQ: false, findings: [{ type: 'missed_escalator', netRecoverable: { amount: 5000 }, grossDetected: { amount: 5000 }, confidence: 0.9 }] } ] };
  const f = (url: string, init?: any) => { if (init && init.method === 'POST') { decided.push(JSON.parse(init.body)); return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'rejected' }) }); } return (fakeFetch(routes) as any)(url); };
  await app.mountLive(doc, { api: { createClient, probe, mapCase }, baseUrl: 'http://api', fetchImpl: f as any });
  const Event = doc.defaultView!.Event;
  (doc.querySelector('[data-case-id]') as any).dispatchEvent(new Event('click'));
  (doc.querySelector('[data-testid="reject-btn"]') as any).dispatchEvent(new Event('click'));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(decided.some((b) => b.decision === 'reject'));
});

test('createClient POST throws on non-ok response', async () => {
  const f = async (_u: string, init?: any) => init && init.method === 'POST' ? { ok: false, status: 422, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({}) };
  const client = createClient('http://api', 'cfo', f as any);
  await assert.rejects(() => client.roi({ annualPlatformCostMinor: 1 }), /-> 422/);
});

test('createClient and probe fall back to global fetch when no fetchImpl is given', async () => {
  const orig = (globalThis as any).fetch;
  const calls: string[] = [];
  (globalThis as any).fetch = async (url: string) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ url }) }; };
  try {
    const client = createClient('http://api', 'cfo'); // no fetchImpl -> uses global fetch (line 38)
    await client.health();
    assert.ok(calls.some((u) => u.indexOf('/api/health') >= 0));
    const ok = await probe('http://api'); // no fetchImpl -> global fetch (line 66)
    assert.equal(ok, true);
  } finally {
    (globalThis as any).fetch = orig;
  }
});

test('createClient/probe handle a missing global fetch (no impl, no global)', async () => {
  const orig = (globalThis as any).fetch;
  // remove global fetch so the (typeof fetch !== undefined ? fetch : null) arm yields null
  delete (globalThis as any).fetch;
  try {
    const client = createClient('http://api', 'cfo'); // f resolves to null (line 38 right arm)
    await assert.rejects(() => client.health(), TypeError); // calling null throws
    assert.equal(await probe('http://api'), false); // !f -> false (line 66-67)
  } finally {
    (globalThis as any).fetch = orig;
  }
});

test('createClient exposes every endpoint method', async () => {
  const seen: string[] = [];
  const f = async (url: string) => { seen.push(url); return { ok: true, status: 200, json: async () => ({}) }; };
  const c = createClient('http://api', 'cfo', f as any);
  await Promise.all([c.health(), c.cases(), c.portfolio(), c.audit(), c.headline(), c.insights(), c.anomalies(), c.leakageByType()]);
  for (const p of ['/api/health','/api/cases','/api/portfolio','/api/audit','/api/headline','/api/insights','/api/anomalies','/api/leakage-by-type']) {
    assert.ok(seen.some((u) => u.endsWith(p)), 'missing ' + p);
  }
});

test('cfoCenterHTML sums approved scenario cases and ignores unknown ids', () => {
  const known = app.cfoCenterHTML({ 'case-acme': 'approved' });
  assert.ok(known.includes('recovered-total'));
  // an approved id not in SCENARIO exercises the (c ? net : 0) else arm
  const unknown = app.cfoCenterHTML({ 'ghost-id': 'approved' });
  assert.ok(unknown.includes('£0.00'));
});

test('mount toggle ON path sets the plain LIVE label', () => {
  const doc = dom();
  const ctrl = app.mount(doc);
  const toggle = doc.querySelector('[data-testid="workiq-toggle"]') as any;
  const Event = doc.defaultView!.Event;
  toggle.checked = false; toggle.dispatchEvent(new Event('change'));
  toggle.checked = true; toggle.dispatchEvent(new Event('change')); // ON arm of line 174
  const mode = doc.querySelector('[data-testid="mode-pill"]')!;
  assert.equal(mode.textContent, '● LIVE');
  assert.ok(ctrl.state.workIQ);
});

test('mountLive: default baseUrl, inspector fallback, pre-decided statuses, dashboard re-render', async () => {
  const doc = dom();
  // remove inspector-body so the (|| inspector) fallback on line 204 is taken
  doc.querySelector('[data-testid="inspector-body"]')!.remove();
  const routes = {
    '/api/health': { ok: true },
    '/api/cases': [
      { id: 'c1', customerId: 'x', status: 'approved', detectedViaWorkIQ: false, findings: [{ type: 't', netRecoverable: { amount: 1 }, grossDetected: { amount: 1 }, confidence: 0.9 }] },
      { id: 'c2', customerId: 'y', status: 'rejected', detectedViaWorkIQ: false, findings: [{ type: 't', netRecoverable: { amount: 1 }, grossDetected: { amount: 1 }, confidence: 0.9 }] },
    ],
    '/api/headline': { totalRecoverableMajor: 1, caseCount: 2, workIQShare: 0 },
    '/api/insights': { runRate: { annualized: { amount: 1 } }, projection: { expectedRecovered: { amount: 1 } }, benchmark: { quartile: 'mid' }, recoveryMaturity: 'developing' },
    '/api/leakage-by-type': [],
    '/api/roi': { totalAnnualBenefit: { amount: 1 }, netAnnualValue: { amount: 1 }, roiMultiple: 1, paybackMonths: 1 },
  };
  // no baseUrl in deps -> line 191 '' default; fakeFetch matches by suffix regardless of host
  const ctrl: any = await app.mountLive(doc, { api: { createClient, probe, mapCase }, fetchImpl: fakeFetch(routes) as any });
  // pre-decided statuses hydrated (lines 212-213)
  assert.equal(ctrl.state.decisions['c1'], 'approved');
  assert.equal(ctrl.state.decisions['c2'], 'rejected');
  const Event = doc.defaultView!.Event;
  // load dashboard twice: second render hits the (state.dash || {}) left side on line 232
  (doc.querySelector('[data-testid="tab-dashboard"]') as any).dispatchEvent(new Event('click'));
  await new Promise((r) => setTimeout(r, 0));
  (doc.querySelector('[data-testid="tab-triage"]') as any).dispatchEvent(new Event('click'));
  (doc.querySelector('[data-testid="tab-dashboard"]') as any).dispatchEvent(new Event('click'));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(ctrl.state.dash);
});

test('mountLive exposes reload() and renders dashboard with no data loaded yet', async () => {
  const doc = dom();
  const routes = {
    '/api/health': { ok: true },
    '/api/cases': [ { id: 'c1', customerId: 'x', status: 'open', detectedViaWorkIQ: false, findings: [{ type: 't', netRecoverable: { amount: 1 }, grossDetected: { amount: 1 }, confidence: 0.9 }] } ],
  };
  const ctrl: any = await app.mountLive(doc, { api: { createClient, probe, mapCase }, baseUrl: 'http://api', fetchImpl: fakeFetch(routes) as any });
  // force a dashboard render while state.dash is still null -> dashboardHTML(state.dash || {}) right arm (L232)
  ctrl.state.tab = 'dashboard';
  ctrl.state.dash = null;
  ctrl.render();
  const body = doc.querySelector('[data-testid="inspector-body"]') || doc.querySelector('[data-testid="inspector"]');
  assert.ok(body!.innerHTML.includes('CFO Dashboard'));
  // exercise reload() (L249)
  await ctrl.reload();
  assert.equal(ctrl.state.cases.length, 1);
});

test('mountLive: Import tab -> upload CSV -> renders recoverable result', async () => {
  const doc = dom();
  const routes = {
    '/api/health': { ok: true },
    '/api/cases': [],
    '/api/import': { totalRecoverableFormatted: 'GBP 6,763.93', rowsAccepted: 4, rowsRejected: 1, summaries: [{ customerId: 'Globex', findingCount: 1, netRecoverableFormatted: 'GBP 4,954.34' }], rejects: [{ row: 6, reason: 'invalid type' }] },
  };
  const api = { createClient, probe, mapCase };
  await app.mountLive(doc, { api, baseUrl: 'http://api', fetchImpl: fakeFetch(routes) as any });
  // click the Import tab
  const tab = doc.querySelector('[data-testid="tab-import"]') as HTMLElement;
  assert.ok(tab, 'import tab exists');
  tab.click();
  // fill the textarea and run
  const ta = doc.querySelector('[data-testid="import-text"]') as HTMLTextAreaElement;
  assert.ok(ta, 'import textarea rendered');
  ta.value = 'customer,line_id,type,expected,actual,currency\nGlobex,INV-1,unbilled_usage,5000,0,GBP';
  const run = doc.querySelector('[data-testid="import-run"]') as HTMLElement;
  assert.ok(run, 'run button rendered');
  run.click();
  // allow the async click handler to resolve
  await new Promise((r) => setTimeout(r, 10));
  const total = doc.querySelector('[data-testid="import-total"]');
  assert.ok(total, 'import result total rendered');
  assert.ok(total!.textContent!.includes('6,763.93'));
  const summary = doc.querySelector('[data-testid="import-summary"]');
  assert.ok(summary!.textContent!.includes('Globex'));
});

test('mountLive: Import tab auto-maps buyer-named headers + template button (S66)', async () => {
  const doc = dom();
  let importBody = null;
  const routes = {
    '/api/health': { ok: true },
    '/api/cases': [],
    '/api/import-template': { template: 'customer,line_id,type' },
    '/api/import': { totalRecoverableFormatted: 'GBP 1,200.00', rowsAccepted: 1, rowsRejected: 0, summaries: [{ customerId: 'Acme', findingCount: 1, netRecoverableFormatted: 'GBP 1,200.00' }], rejects: [] },
  };
  const baseFetch = fakeFetch(routes);
  const captureFetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('/api/import') && url.indexOf('template') < 0 && opts && opts.body) importBody = JSON.parse(opts.body);
    return baseFetch(url, opts);
  };
  const api = { createClient, probe, mapCase };
  await app.mountLive(doc, { api, baseUrl: 'http://api', fetchImpl: captureFetch });
  (doc.querySelector('[data-testid="tab-import"]')).click();
  const tmpl = doc.querySelector('[data-testid="import-template"]');
  assert.ok(tmpl, 'template button rendered');
  const ta = doc.querySelector('[data-testid="import-text"]');
  ta.value = 'Account,Invoice Number,Category,Expected Amount,Invoice Amount,CCY\nAcme,INV-1,price_changed,12000,10800,GBP';
  (doc.querySelector('[data-testid="import-run"]')).click();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(importBody, 'import POST was made');
  assert.ok(importBody.mapping, 'a mapping was auto-suggested and sent');
  assert.equal(importBody.mapping['Invoice Amount'], 'actual');
  assert.equal(importBody.mapping['Account'], 'customer');
});

test('mountLive: Import tab file upload fills the textarea (S67)', async () => {
  const doc = dom();
  const routes = { '/api/health': { ok: true }, '/api/cases': [] };
  const api = { createClient, probe, mapCase };
  await app.mountLive(doc, { api, baseUrl: 'http://api', fetchImpl: fakeFetch(routes) });
  (doc.querySelector('[data-testid="tab-import"]')).click();
  const fileInput = doc.querySelector('[data-testid="import-file"]');
  assert.ok(fileInput, 'file input rendered');
  const csv = 'customer,line_id,type,expected,actual,currency\nAcme,INV-1,price_changed,12000,10800,GBP';
  const file = new File([csv], 'billing.csv', { type: 'text/csv' });
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  fileInput.dispatchEvent(new doc.defaultView.Event('change'));
  await new Promise((r) => setTimeout(r, 20));
  const ta = doc.querySelector('[data-testid="import-text"]');
  assert.ok(ta.value.includes('Acme,INV-1'), 'textarea filled from file');
  const fn = doc.querySelector('[data-testid="import-filename"]');
  assert.equal(fn.textContent, 'billing.csv');
});
