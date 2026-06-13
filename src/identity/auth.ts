/**
 * Authentication seam (S60).
 *
 * Replaces the demo x-user-id header shim with a token-verification seam. A TokenVerifier turns a
 * bearer token into VerifiedClaims (at minimum a subject id). Production wires an OIDC/Entra JWKS
 * verifier behind this interface; offline/demo uses the HMAC DevTokenIssuer below, which both
 * issues and verifies deterministically with no network.
 *
 * Downstream authorization (RBAC + customer scoping) is unchanged: claims.sub maps to a
 * provisioned user, which resolves to an AuthenticatedPrincipal exactly as before.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export class AuthError extends Error {
  constructor(message: string) { super(message); this.name = 'AuthError'; }
}

export interface VerifiedClaims {
  readonly sub: string;
  readonly iss?: string;
  readonly exp?: number;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedClaims>;
}

function stripPad(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === '=') end--;
  return s.slice(0, end);
}
function b64url(buf: Buffer): string {
  return stripPad(buf.toString('base64').split('+').join('-').split('/').join('_'));
}
function b64urlJson(obj: unknown): string {
  return b64url(Buffer.from(JSON.stringify(obj), 'utf8'));
}
function fromB64urlJson(s: string): unknown {
  const padLen = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b64 = s.split('-').join('+').split('_').join('/') + '='.repeat(padLen);
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

function sign(signingInput: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(signingInput).digest());
}

export class DevTokenIssuer implements TokenVerifier {
  constructor(private secret: string, private clock: () => number = () => Math.floor(Date.now() / 1000)) {
    if (!secret || secret.length < 8) throw new AuthError('Dev signing secret must be at least 8 chars');
  }

  issue(sub: string, ttlSeconds = 3600, iss = 'revenuetwin-dev'): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload: VerifiedClaims = { sub, iss, exp: this.clock() + ttlSeconds };
    const signingInput = b64urlJson(header) + '.' + b64urlJson(payload);
    return signingInput + '.' + sign(signingInput, this.secret);
  }

  async verify(token: string): Promise<VerifiedClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new AuthError('Malformed token');
    const signingInput = parts[0] + '.' + parts[1];
    const expected = sign(signingInput, this.secret);
    const a = Buffer.from(parts[2]!);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AuthError('Bad signature');
    let claims: VerifiedClaims;
    try {
      claims = fromB64urlJson(parts[1]!) as VerifiedClaims;
    } catch {
      throw new AuthError('Malformed claims');
    }
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) throw new AuthError('Token has no subject');
    if (typeof claims.exp === 'number' && this.clock() >= claims.exp) throw new AuthError('Token expired');
    return claims;
  }
}

/**
 * Production OIDC/Entra config (the seam a real verifier is constructed from). The implementation
 * (JWKS fetch + RS256 verify + issuer/audience checks) lives at the deployment edge and is wired
 * behind TokenVerifier; the rest of the app depends only on the interface, so it stays offline-safe.
 */
export interface OidcConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri: string;
}

/**
 * Extract a bearer token from an Authorization header value. Returns null when absent/malformed,
 * so the caller can fall back to the dev header shim when no verifier is configured.
 */
export function bearerToken(authHeader: string | undefined): string | null {
  if (typeof authHeader !== 'string') return null;
  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) return null;
  const tok = authHeader.slice(prefix.length).trim();
  return tok.length > 0 ? tok : null;
}
