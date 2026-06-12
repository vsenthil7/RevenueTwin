/**
 * HTTP API server (integration).
 *
 * A dependency-free Node http server that exposes RevenueTwinApp over REST and serves the web UI.
 * Auth is a demo shim: the `x-user-id` header selects a provisioned user, resolved to an
 * authenticated principal via the UserStore. In production this is replaced by SAML/OIDC, but the
 * authorization model (RBAC + customer scoping) downstream is identical.
 *
 * This is the piece that turns the domain modules into something a browser can actually use.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, normalize } from 'node:path';
import { RevenueTwinApp, AppError } from './application.ts';
import { UserStore, type AuthenticatedPrincipal } from '../identity/rbac.ts';
import { RuleBasedExtractor } from '../intent/extraction.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export interface ServerDeps {
  app: RevenueTwinApp;
  users: UserStore;
  webRoot: string;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('Invalid JSON body');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function errorStatus(e: unknown): number {
  if (e instanceof AppError) {
    return e.code === 'forbidden' ? 403 : e.code === 'not_found' ? 404 : 400;
  }
  return 500;
}

/** Resolve the principal from the x-user-id header. Throws AppError(forbidden) if missing/unknown. */
export function resolvePrincipal(users: UserStore, req: IncomingMessage): AuthenticatedPrincipal {
  const userId = req.headers['x-user-id'];
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError('Missing x-user-id header', 'forbidden');
  }
  try {
    return users.authenticate(userId);
  } catch {
    throw new AppError(`Unknown or inactive user '${userId}'`, 'forbidden');
  }
}

/**
 * Route a single request. Exported for in-process testing without binding a socket.
 * Returns the [status, body] it sent, for test assertions.
 */
export async function handleApi(
  deps: ServerDeps, method: string, path: string, query: URLSearchParams, body: unknown, req: IncomingMessage,
): Promise<{ status: number; body: unknown }> {
  const { app, users } = deps;

  // Health is unauthenticated.
  if (method === 'GET' && path === '/api/health') {
    return { status: 200, body: { ok: true, tenant: app.tenantId, currency: app.currency } };
  }

  const principal = resolvePrincipal(users, req);

  if (method === 'GET' && path === '/api/cases') {
    return { status: 200, body: await app.listCases(principal) };
  }
  if (method === 'GET' && path === '/api/cases/top') {
    const limit = Number(query.get('limit') ?? '5');
    return { status: 200, body: await app.topCases(principal, limit) };
  }
  if (method === 'GET' && path.startsWith('/api/cases/')) {
    const id = decodeURIComponent(path.slice('/api/cases/'.length));
    return { status: 200, body: await app.getCase(principal, id) };
  }
  if (method === 'POST' && path === '/api/cases') {
    const b = body as { customerId?: unknown; findings?: unknown; detectedViaWorkIQ?: boolean; at?: string };
    if (typeof b.customerId !== 'string' || !Array.isArray(b.findings)) {
      throw new AppError('customerId (string) and findings (array) are required');
    }
    const c = await app.openCase(principal, b.customerId, b.findings as never[], b.detectedViaWorkIQ ?? false, b.at ?? new Date().toISOString());
    return { status: 201, body: c };
  }
  if (method === 'POST' && path.match(/^\/api\/cases\/[^/]+\/decision$/)) {
    const id = decodeURIComponent(path.split('/')[3]!);
    const b = body as { decision?: unknown; at?: string };
    if (b.decision !== 'approve' && b.decision !== 'reject') {
      throw new AppError("decision must be 'approve' or 'reject'");
    }
    const c = await app.decideCase(principal, id, b.decision, b.at ?? new Date().toISOString());
    return { status: 200, body: c };
  }
  if (method === 'POST' && path === '/api/intent/ingest') {
    const b = body as { doc?: import('../intent/extraction.ts').IntentDocument; minConfidence?: number };
    if (!b.doc || typeof b.doc !== 'object') throw new AppError('doc is required');
    const ev = await app.ingestIntent(principal, new RuleBasedExtractor(), b.doc, b.minConfidence ?? 0.6);
    return { status: 200, body: { event: ev } };
  }
  if (method === 'GET' && path === '/api/portfolio') {
    return { status: 200, body: await app.portfolioSummary(principal) };
  }
  if (method === 'GET' && path === '/api/leakage-by-type') {
    return { status: 200, body: await app.leakageByType(principal) };
  }
  if (method === 'GET' && path === '/api/period-close') {
    const from = query.get('from'), to = query.get('to');
    if (!from || !to) throw new AppError('from and to required');
    return { status: 200, body: await app.periodClose(principal, from, to) };
  }
  if (method === 'GET' && path === '/api/audit') {
    return { status: 200, body: { entries: await app.auditTrail(principal), intact: await app.auditIntact(principal) } };
  }
  if (method === 'GET' && path === '/api/total-recoverable') {
    return { status: 200, body: await app.totalRecoverable(principal) };
  }
  if (method === 'GET' && path === '/api/headline') {
    return { status: 200, body: await app.headline(principal) };
  }
  if (method === 'GET' && path === '/api/insights') {
    const arrMinor = query.get('arrMinor');
    const windowDays = query.get('windowDays');
    return { status: 200, body: await app.insights(principal, {
      ...(arrMinor ? { arrMinor: Number(arrMinor) } : {}),
      ...(windowDays ? { windowDays: Number(windowDays) } : {}),
    }) };
  }
  if (method === 'POST' && path === '/api/roi') {
    const b = body as { annualPlatformCostMinor?: unknown; analystHoursSavedPerMonth?: unknown; analystHourlyCostMinor?: unknown; windowDays?: number };
    if (typeof b.annualPlatformCostMinor !== 'number' || typeof b.analystHoursSavedPerMonth !== 'number' || typeof b.analystHourlyCostMinor !== 'number') {
      throw new AppError('annualPlatformCostMinor, analystHoursSavedPerMonth, analystHourlyCostMinor (numbers) required');
    }
    return { status: 200, body: await app.roi(principal, {
      annualPlatformCostMinor: b.annualPlatformCostMinor,
      analystHoursSavedPerMonth: b.analystHoursSavedPerMonth,
      analystHourlyCostMinor: b.analystHourlyCostMinor,
      windowDays: typeof b.windowDays === 'number' ? b.windowDays : 90,
    }) };
  }
  if (method === 'GET' && path === '/api/anomalies') {
    return { status: 200, body: await app.anomalies(principal) };
  }
  if (method === 'GET' && path === '/api/evidence-pack') {
    const from = query.get('from'), to = query.get('to');
    if (!from || !to) throw new AppError('from and to required');
    return { status: 200, body: await app.evidencePack(principal, from, to, new Date().toISOString()) };
  }

  return { status: 404, body: { error: 'Not found', path } };
}

export async function serveStatic(webRoot: string, urlPath: string, res: ServerResponse): Promise<void> {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = normalize(resolve(webRoot, '.' + rel));
  if (!filePath.startsWith(webRoot)) { res.writeHead(403).end('Forbidden'); return; }
  try {
    const buf = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

/**
 * Handle one request: route /api/* through handleApi, otherwise serve static. Exported so tests
 * can drive it with fake req/res without binding a socket; createApiServer is a thin wrapper.
 */
export async function dispatch(deps: ServerDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    if (path.startsWith('/api/')) {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const result = await handleApi(deps, req.method ?? 'GET', path, url.searchParams, body, req);
      sendJson(res, result.status, result.body);
      return;
    }
    await serveStatic(deps.webRoot, path, res);
  } catch (e) {
    const status = errorStatus(e);
    sendJson(res, status, { error: e instanceof Error ? e.message : 'Internal error' });
  }
}

/** Build (but do not listen on) the http server. */
export function createApiServer(deps: ServerDeps): Server {
  return createServer((req, res) => { void dispatch(deps, req, res); });
}
