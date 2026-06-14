/**
 * Web server: boots RevenueTwin and serves the web/ console + REST API.
 *
 * Persistence is selected by environment: if DATABASE_URL is set we wire the real Postgres edge
 * (durable across restarts); otherwise we run in-memory (demo/dev). Used by playwright.config.ts
 * (webServer), the Docker image (npm start), and local demo (npm run serve:web).
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { bootstrap } from '../src/app/bootstrap.ts';
import { createApiServer } from '../src/app/server.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../web');
const port = Number(process.env.PORT ?? 8787);
const databaseUrl = process.env.DATABASE_URL;

let bootOpts: Parameters<typeof bootstrap>[0] = {};
if (databaseUrl && databaseUrl.length > 0) {
  // Production: wire the real pg driver at the edge, ensure the schema + tenant row exist, and
  // seed the demo portfolio only on a fresh database (so restarts keep prior, real decisions).
  const tenantId = process.env.TENANT_ID ?? 'northwind-tenant';
  const { createPgEdge, runSchema } = await import('../src/edge/pg-factory.ts');
  const { factory, pool } = await createPgEdge();
  await runSchema(pool, tenantId);
  const existing = await pool.query('SELECT count(*)::int AS n FROM leakage_case WHERE tenant_id = $1', [tenantId]);
  const hasData = Number((existing.rows[0] as { n: number }).n) > 0;
  bootOpts = { databaseUrl, backend: 'postgres', pgClientFactory: factory, tenantId, seedCase: !hasData };
  // eslint-disable-next-line no-console
  console.log('RevenueTwin persistence: postgres (durable); seeded=' + String(!hasData));
} else {
  // eslint-disable-next-line no-console
  console.log('RevenueTwin persistence: in-memory (set DATABASE_URL for durable storage)');
}

// Authentication is selected by environment: if OIDC_ISSUER/OIDC_AUDIENCE/OIDC_JWKS_URI are set
// we wire the real OIDC/Entra verifier (RS256 + JWKS); otherwise the x-user-id demo shim is used.
let verifier: import('../src/identity/auth.ts').TokenVerifier | undefined;
const oidcIssuer = process.env.OIDC_ISSUER;
const oidcAudience = process.env.OIDC_AUDIENCE;
const oidcJwksUri = process.env.OIDC_JWKS_URI;
if (oidcIssuer && oidcAudience && oidcJwksUri) {
  const { OidcTokenVerifier } = await import('../src/identity/oidc.ts');
  const fetchJwks = async (uri: string) => {
    const r = await fetch(uri);
    if (!r.ok) throw new Error('JWKS fetch failed: ' + r.status);
    return (await r.json()) as { keys: import('../src/identity/oidc.ts').Jwk[] };
  };
  verifier = new OidcTokenVerifier({ issuer: oidcIssuer, audience: oidcAudience, jwksUri: oidcJwksUri }, fetchJwks);
  // eslint-disable-next-line no-console
  console.log('RevenueTwin auth: OIDC (issuer=' + oidcIssuer + ')');
} else {
  // eslint-disable-next-line no-console
  console.log('RevenueTwin auth: x-user-id demo shim (set OIDC_ISSUER/OIDC_AUDIENCE/OIDC_JWKS_URI for real auth)');
}

const { app, users, backend } = await bootstrap(bootOpts);
const server = createApiServer({ app, users, webRoot, verifier });
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log('RevenueTwin serving on http://127.0.0.1:' + port + ' (backend: ' + backend + ')');
});
