/**
 * Production OIDC/Entra token verifier (S65).
 *
 * Implements the TokenVerifier seam from S60 with real RS256 JWT verification against a
 * JWKS key set, plus issuer/audience/expiry/nbf checks. Keeps the core dependency-free:
 * verification uses only Node built-in crypto, and the JWKS fetch is injected (JwksFetcher)
 * so the verifier is fully testable offline with a fake key set and self-signed tokens.
 */
import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';
import { AuthError, type OidcConfig, type TokenVerifier, type VerifiedClaims } from './auth.ts';

/** A single JWK (RSA public key) as published at a JWKS endpoint. */
export interface Jwk {
  readonly kty: string;
  readonly kid: string;
  readonly n: string;
  readonly e: string;
  readonly alg?: string;
}

/** Fetches the JWKS key set. Injected so production does an HTTPS GET of config.jwksUri
 * while tests supply a static set. */
export type JwksFetcher = (jwksUri: string) => Promise<{ keys: Jwk[] }>;

interface JwtHeader { alg?: string; kid?: string; typ?: string; }

function decodeSegment(seg: string): unknown {
  const padLen = seg.length % 4 === 0 ? 0 : 4 - (seg.length % 4);
  const b64 = seg.split('-').join('+').split('_').join('/') + '='.repeat(padLen);
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

function jwkToPemKey(jwk: Jwk): KeyObject {
  // Node can import a JWK RSA public key directly.
  return createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e } as unknown as JsonWebKey, format: 'jwk' });
}

/** OIDC/Entra verifier: RS256 JWT + iss/aud/exp/nbf checks against a cached JWKS. */
export class OidcTokenVerifier implements TokenVerifier {
  private cache: Map<string, KeyObject> | null = null;
  constructor(
    private config: OidcConfig,
    private fetchJwks: JwksFetcher,
    private clock: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  private async keyFor(kid: string | undefined): Promise<KeyObject> {
    if (this.cache === null) {
      const { keys } = await this.fetchJwks(this.config.jwksUri);
      const m = new Map<string, KeyObject>();
      for (const k of keys) m.set(k.kid, jwkToPemKey(k));
      this.cache = m;
    }
    // If the kid is unknown, refresh once (key rotation).
    if (kid !== undefined && !this.cache.has(kid)) {
      const { keys } = await this.fetchJwks(this.config.jwksUri);
      const m = new Map<string, KeyObject>();
      for (const k of keys) m.set(k.kid, jwkToPemKey(k));
      this.cache = m;
    }
    const key = kid !== undefined ? this.cache.get(kid) : [...this.cache.values()][0];
    if (!key) throw new AuthError('No matching JWKS key for kid');
    return key;
  }


  async verify(token: string): Promise<VerifiedClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new AuthError('Malformed token');
    let header: JwtHeader;
    let payload: Record<string, unknown>;
    try {
      header = decodeSegment(parts[0]!) as JwtHeader;
      payload = decodeSegment(parts[1]!) as Record<string, unknown>;
    } catch {
      throw new AuthError('Malformed token segments');
    }
    if (header.alg !== 'RS256') throw new AuthError('Unsupported alg expected RS256');
    const key = await this.keyFor(header.kid);
    const signingInput = parts[0] + '.' + parts[1];
    const sigB64 = parts[2]!.split('-').join('+').split('_').join('/');
    const sig = Buffer.from(sigB64, 'base64');
    const v = createVerify('RSA-SHA256');
    v.update(signingInput);
    v.end();
    if (!v.verify(key, sig)) throw new AuthError('Bad signature');
    const now = this.clock();
    if (typeof payload.exp === 'number' && now >= payload.exp) throw new AuthError('Token expired');
    if (typeof payload.nbf === 'number' && now < payload.nbf) throw new AuthError('Token not yet valid');
    if (payload.iss !== this.config.issuer) throw new AuthError('Bad issuer');
    const aud = payload.aud;
    const audOk = Array.isArray(aud) ? aud.includes(this.config.audience) : aud === this.config.audience;
    if (!audOk) throw new AuthError('Bad audience');
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new AuthError('Token has no subject');
    const claims: VerifiedClaims = { sub: payload.sub, iss: this.config.issuer };
    if (typeof payload.exp === 'number') return { ...claims, exp: payload.exp };
    return claims;
  }
}
