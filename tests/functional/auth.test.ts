import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DevTokenIssuer, AuthError, bearerToken, type TokenVerifier } from '../../src/identity/auth.ts';
import { resolvePrincipal, dispatch, type ServerDeps } from '../../src/app/server.ts';
import { bootstrap } from '../../src/app/bootstrap.ts';

function seqClock(start = '2026-04-01T00:00:00.000Z'): () => string {
  let t = Date.parse(start);
  return () => { const iso = new Date(t).toISOString(); t += 1000; return iso; };
}
async function deps(verifier?: TokenVerifier): Promise<ServerDeps> {
  const { app, users } = await bootstrap({ seedCase: false, clock: seqClock() });
  return { app, users, webRoot: '/tmp/none', verifier };
}
function fakeReq(headers: Record<string,string>, method = 'GET', url = '/api/cases'): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  (req as { headers: Record<string,string> }).headers = headers;
  (req as { method: string }).method = method;
  (req as { url: string }).url = url;
  return req;
}
function fakeRes(): ServerResponse & { _status: number; _body: string } {
  const res: any = { _status: 0, _body: '' };
  res.writeHead = (s: number) => { res._status = s; return res; };
  res.end = (c?: string) => { if (c) res._body += c; return res; };
  return res as ServerResponse & { _status: number; _body: string };
}
// fixed-time clock (seconds) for deterministic expiry tests
function secClock(t: number): () => number { return () => t; }

test('DevTokenIssuer: issue then verify round-trips the subject', async () => {
  const iss = new DevTokenIssuer('dev-secret-123', secClock(1000));
  const token = iss.issue('cfo', 3600);
  const claims = await iss.verify(token);
  assert.equal(claims.sub, 'cfo');
  assert.equal(claims.iss, 'revenuetwin-dev');
  assert.equal(claims.exp, 1000 + 3600);
});

test('DevTokenIssuer: constructor rejects a weak secret', () => {
  assert.throws(() => new DevTokenIssuer('short'), AuthError);
});

test('DevTokenIssuer: a tampered signature is rejected', async () => {
  const iss = new DevTokenIssuer('dev-secret-123', secClock(1000));
  const token = iss.issue('cfo');
  const parts = token.split('.');
  const forged = parts[0] + '.' + parts[1] + '.' + 'AAAA' + parts[2]!.slice(4);
  await assert.rejects(() => iss.verify(forged), AuthError);
});

test('DevTokenIssuer: a token signed by another secret fails', async () => {
  const a = new DevTokenIssuer('secret-aaaaaa', secClock(1000));
  const b = new DevTokenIssuer('secret-bbbbbb', secClock(1000));
  const token = a.issue('cfo');
  await assert.rejects(() => b.verify(token), AuthError);
});

test('DevTokenIssuer: an expired token is rejected', async () => {
  const iss = new DevTokenIssuer('dev-secret-123', secClock(1000));
  const token = iss.issue('cfo', 10); // exp = 1010
  const later = new DevTokenIssuer('dev-secret-123', secClock(2000));
  await assert.rejects(() => later.verify(token), /expired/);
});

test('DevTokenIssuer: malformed token shapes are rejected', async () => {
  const iss = new DevTokenIssuer('dev-secret-123', secClock(1000));
  await assert.rejects(() => iss.verify('only.two'), /Malformed token/);
  // valid signature over a payload that is NOT valid JSON -> Malformed claims (lines 73-74)
  const { createHmac } = await import('node:crypto');
  const strip = (x: string) => { let e = x.length; while (e>0 && x[e-1]==='=') e--; return x.slice(0,e); };
  const b64 = (buf: string) => strip(Buffer.from(buf).toString('base64').split('+').join('-').split('/').join('_'));
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const badPayload = b64('this-is-not-json');
  const signingInput = header + '.' + badPayload;
  const sig2 = strip(createHmac('sha256', 'dev-secret-123').update(signingInput).digest('base64').split('+').join('-').split('/').join('_'));
  await assert.rejects(() => iss.verify(signingInput + '.' + sig2), /Malformed claims/);
});

test('DevTokenIssuer: a token with an empty subject is rejected', async () => {
  const iss = new DevTokenIssuer('dev-secret-123', secClock(1000));
  const token = iss.issue('', 3600);
  await assert.rejects(() => iss.verify(token), /no subject/);
});

test('bearerToken parses a valid header and rejects others', () => {
  assert.equal(bearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
  assert.equal(bearerToken('bearer lowercase'), null);
  assert.equal(bearerToken('Basic xyz'), null);
  assert.equal(bearerToken('Bearer    '), null);
  assert.equal(bearerToken(undefined), null);
});

test('server with a verifier: a valid bearer token authenticates', async () => {
  const iss = new DevTokenIssuer('dev-secret-123');
  const d = await deps(iss);
  const token = iss.issue('cfo');
  const res = fakeRes();
  await dispatch(d, fakeReq({ authorization: 'Bearer ' + token }, 'GET', '/api/cases'), res);
  assert.equal(res._status, 200);
});

test('server with a verifier: a missing token is 403', async () => {
  const iss = new DevTokenIssuer('dev-secret-123');
  const d = await deps(iss);
  const res = fakeRes();
  await dispatch(d, fakeReq({}, 'GET', '/api/cases'), res);
  assert.equal(res._status, 403);
});

test('server with a verifier: an invalid token is 403', async () => {
  const iss = new DevTokenIssuer('dev-secret-123');
  const d = await deps(iss);
  const res = fakeRes();
  await dispatch(d, fakeReq({ authorization: 'Bearer not.a.token' }, 'GET', '/api/cases'), res);
  assert.equal(res._status, 403);
});

test('server with a verifier: a valid token for an unprovisioned subject is 403', async () => {
  const iss = new DevTokenIssuer('dev-secret-123');
  const d = await deps(iss);
  const token = iss.issue('ghost-user');
  const res = fakeRes();
  await dispatch(d, fakeReq({ authorization: 'Bearer ' + token }, 'GET', '/api/cases'), res);
  assert.equal(res._status, 403);
});
