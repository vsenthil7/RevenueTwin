import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, type KeyObject } from 'node:crypto';
import { OidcTokenVerifier, type Jwk } from '../../src/identity/oidc.ts';
import { AuthError } from '../../src/identity/auth.ts';

// Generate a real RSA keypair once; build a JWKS from the public key and sign real RS256 JWTs.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pubJwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string; kty: string };
const KID = 'test-key-1';
const jwks: { keys: Jwk[] } = { keys: [{ kty: pubJwk.kty, kid: KID, n: pubJwk.n, e: pubJwk.e }] };
const fetchJwks = async () => jwks;
const CONFIG = { issuer: 'https://issuer.test', audience: 'revenuetwin', jwksUri: 'https://issuer.test/jwks' };
const NOW = 1_000_000;
const clock = () => NOW;

function b64url(buf: Buffer): string {
  return buf.toString('base64').split('+').join('-').split('/').join('_').replace(/=+$/, '');
}
function makeJwt(payload: Record<string, unknown>, opts: { kid?: string; alg?: string; key?: KeyObject } = {}): string {
  const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? KID, typ: 'JWT' };
  const h = b64url(Buffer.from(JSON.stringify(header)));
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = h + '.' + p;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const sig = b64url(signer.sign(opts.key ?? privateKey));
  return signingInput + '.' + sig;
}

function validPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { sub: 'cfo', iss: CONFIG.issuer, aud: CONFIG.audience, exp: NOW + 3600, ...over };
}

test('verifies a valid RS256 token and returns claims', async () => {
  const v = new OidcTokenVerifier(CONFIG, fetchJwks, clock);
  const claims = await v.verify(makeJwt(validPayload()));
  assert.equal(claims.sub, 'cfo');
  assert.equal(claims.iss, CONFIG.issuer);
  assert.equal(claims.exp, NOW + 3600);
});

test('accepts array audience containing the configured audience', async () => {
  const v = new OidcTokenVerifier(CONFIG, fetchJwks, clock);
  const claims = await v.verify(makeJwt(validPayload({ aud: ['other', CONFIG.audience] })));
  assert.equal(claims.sub, 'cfo');
});

test('token without exp is accepted (returns claims without exp)', async () => {
  const v = new OidcTokenVerifier(CONFIG, fetchJwks, clock);
  const p = validPayload();
  delete p.exp;
  const claims = await v.verify(makeJwt(p));
  assert.equal(claims.exp, undefined);
});

test('rejects a malformed token (wrong segment count)', async () => {
  const v = new OidcTokenVerifier(CONFIG, fetchJwks, clock);
  await assert.rejects(() => v.verify('a.b'), AuthError);
});

test('rejects unsupported alg', async () => {
  const v = new OidcTokenVerifier(CONFIG, fetchJwks, clock);
  await assert.rejects(() => v.verify(makeJwt(validPayload(), { alg: 'HS256' })), /Unsupported alg/);
});

test('rejects a bad signature (signed by a different key)', async () => {
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const v = new OidcTokenVerifier(CONFIG, fetchJwks, clock);
  await assert.rejects(() => v.verify(makeJwt(validPayload(), { key: other })), /Bad signature/);
});

test('rejects an expired token', async () => {
  const v = new OidcTokenVerifier(CONFIG, fetchJwks, clock);
  await assert.rejects(() => v.verify(makeJwt(validPayload({ exp: NOW - 1 }))), /expired/);
});

test('rejects a not-yet-valid token (nbf in future)', async () => {
  const v = new OidcTokenVerifier(CONFIG, fetchJwks, clock);
  await assert.rejects(() => v.verify(makeJwt(validPayload({ nbf: NOW + 100 }))), /not yet valid/);
});

test('rejects a bad issuer', async () => {
  const v = new OidcTokenVerifier(CONFIG, fetchJwks, clock);
  await assert.rejects(() => v.verify(makeJwt(validPayload({ iss: 'https://evil.test' }))), /Bad issuer/);
});

test('rejects a bad audience', async () => {
  const v = new OidcTokenVerifier(CONFIG, fetchJwks, clock);
  await assert.rejects(() => v.verify(makeJwt(validPayload({ aud: 'someone-else' }))), /Bad audience/);
});

test('rejects a token with no subject', async () => {
  const v = new OidcTokenVerifier(CONFIG, fetchJwks, clock);
  const p = validPayload();
  delete p.sub;
  await assert.rejects(() => v.verify(makeJwt(p)), /no subject/);
});

test('no-kid header verifies against the first cached key', async () => {
  const v = new OidcTokenVerifier(CONFIG, fetchJwks, clock);
  // build a token whose header has no kid
  const p = validPayload();
  const header = { alg: 'RS256', typ: 'JWT' };
  const b64 = (b: Buffer) => b.toString('base64').split('+').join('-').split('/').join('_').replace(/=+$/, '');
  const si = b64(Buffer.from(JSON.stringify(header))) + '.' + b64(Buffer.from(JSON.stringify(p)));
  const { createSign } = await import('node:crypto');
  const s = createSign('RSA-SHA256'); s.update(si); s.end();
  const tok = si + '.' + b64(s.sign(privateKey));
  const claims = await v.verify(tok);
  assert.equal(claims.sub, 'cfo');
});

test('unknown kid triggers a JWKS refresh then fails if still absent', async () => {
  let calls = 0;
  const refetch = async () => { calls++; return jwks; };
  const v = new OidcTokenVerifier(CONFIG, refetch, clock);
  await assert.rejects(() => v.verify(makeJwt(validPayload(), { kid: 'no-such-kid' })), /No matching JWKS key/);
  assert.ok(calls >= 2, 'should refetch on unknown kid');
});

test('rejects malformed token segments (non-JSON)', async () => {
  const v = new OidcTokenVerifier(CONFIG, fetchJwks, clock);
  await assert.rejects(() => v.verify('!!!.@@@.###'), AuthError);
});

test('default clock (no clock injected) verifies a token with a real future exp', async () => {
  const v = new OidcTokenVerifier(CONFIG, fetchJwks);
  const realExp = Math.floor(Date.now() / 1000) + 3600;
  const claims = await v.verify(makeJwt(validPayload({ exp: realExp })));
  assert.equal(claims.sub, 'cfo');
});
