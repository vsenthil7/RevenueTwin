# RevenueTwin — Deployment & Operations Packet (S11)

## 1. Deployment topology

RevenueTwin is a dependency-light TypeScript service plus a static web console and a Flutter
mobile client, all speaking one REST API. The engine is deliberately driver-free; production
concerns are wired at the edge.

- **API service**: Node 22+, `createApiServer(deps)` over `node:http`. Stateless; scale horizontally.
- **Persistence**: Postgres in production (selected automatically when `DATABASE_URL` is set, see
  `src/app/persistence-factory.ts`). In-memory only for demo/test/`forceMemory`.
- **Web console**: static assets in `web/` served by the API (or any CDN/static host).
- **Mobile**: Flutter app in `mobile/`, points at the same API base URL.

### Container
A single Node image runs the API and serves `web/`. Recommended: distroless Node base, non-root
user, read-only filesystem, `DATABASE_URL` and `AUTH_*` from secrets. Health endpoint: `GET /api/health`.

## 2. Configuration

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Selects Postgres backend; absent -> in-memory | (unset) |
| `PORT` | API listen port | 8787 (serve-web) / 4173 (serve) |
| `AUTH_ISSUER` / `AUTH_AUDIENCE` / `AUTH_JWKS_URI` | OIDC/Entra verifier (S60 `OidcConfig`) | (unset) |
| `DEV_TOKEN_SECRET` | HMAC secret for offline DevTokenIssuer (dev only) | (unset) |

When no token verifier is configured the API falls back to the `x-user-id` demo shim — never enable
that in production. Wire a real `TokenVerifier` (OIDC/Entra) via `ServerDeps.verifier`.

## 3. Security posture

- **AuthN**: bearer-token verification seam (`src/identity/auth.ts`). Production = OIDC/Entra JWKS.
- **AuthZ**: deterministic RBAC + per-customer scoping enforced on every state change
  (`requirePerm` -> `uow.transaction` -> audit). Roles: cfo, controller, revops, legal, collections,
  auditor, admin.
- **Audit**: tamper-evident SHA-256 hash chain (`src/core/audit.ts`); any doctored or re-hashed
  entry breaks `verifyChain` (proven in `tests/negative/audit-tamper.test.ts`).
- **Input handling**: malformed input and prompt-injection text are treated as inert data, never
  executed (`tests/negative/malformed-input.test.ts`).
- **Separation of duties**: triage and approval are distinct permissions; revops cannot approve.
- **Determinism**: the engine decides pass/fail; LLM/Work IQ extraction only proposes signals that
  the deterministic reconciliation must still confirm.

## 4. ROI model

`POST /api/roi` computes annual benefit from recovered leakage plus analyst hours saved, against
platform cost, returning total/net annual benefit, ROI multiple and payback months. The seeded
Northwind portfolio alone surfaces a £1,200 intent-only leak invisible to structural-only tooling;
the moat is the recall delta (0% blind -> 100% sighted) on commercial-intent leakage.

## 5. Admin runbook

- **Provision users**: `UserStore.provision({ id, email, roles, allowedCustomers, active })`.
- **Deactivate**: `UserStore.deactivate(id)` — inactive users cannot authenticate.
- **Scope a user to customers**: `setCustomerScope(id, [..])` or `*`.
- **Verify integrity**: `make status` prints health, backend, roles, portfolio and audit-chain state.
- **Reproduce the proof**: `make demo-offline` runs the Golden Thread with no network.
- **Seed manifest**: `make seed` prints the deterministic portfolio + audit head.

## 6. Observability & DR

- Health: `GET /api/health`. Audit integrity: `app.auditIntact()` (surface as a periodic check).
- Postgres is the system of record; back it up. The audit chain is verifiable independently, so
  tamper detection survives a restore.
- The service is stateless apart from Postgres; redeploy freely.

## 7. Production deployment (S70)

- **Secrets**: copy `.env.example` to `.env` and set real values. `.env` is git-ignored; never
  commit secrets. docker-compose substitutes `POSTGRES_USER/PASSWORD/DB` from the environment
  and fails fast (`:?`) if any are unset, so the stack cannot start with missing credentials.
- **One-command deploy**: `./deploy.sh` refuses to run without `.env`, rejects the placeholder
  password, builds + starts the stack, then health-gates: it polls `GET /api/health` and only
  reports success once the API is actually healthy (no race on a still-booting container).
- **Real auth**: set `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI` in `.env` to enable the
  OIDC/Entra verifier (S65). If unset, the app logs that it is using the x-user-id demo shim,
  which must NOT be used with real financial data.
- **HTTPS/TLS**: the app speaks plain HTTP on 8787 and is designed to run behind a TLS-terminating
  reverse proxy (nginx, Caddy, or a cloud load balancer). Terminate TLS there, forward to the
  container, and restrict the container port to the proxy. Do not expose 8787 to the public
  internet directly. Set HSTS at the proxy.
- **Health-gated restarts**: both services declare healthchecks; the API waits for Postgres to be
  healthy before starting, and Docker will restart unhealthy containers (`restart: unless-stopped`).
