# Integration & Run Guide

This document describes the integration layer that turns RevenueTwin's domain modules into a
running product, and exactly how to run and verify it. It is the entry point for operating the
system (no code changes required).

## What the integration layer is

The ~40 domain modules under `src/` (reconciliation, Work IQ, revenue recognition, tax, churn,
disputes, etc.) are tested libraries. Three modules under `src/app/` compose them into a live
service:

- **`src/app/application.ts` — `RevenueTwinApp`**: the unified facade. Every state-changing call
  (1) checks an authenticated principal's permission via RBAC + customer scope, (2) writes through
  the persistence `UnitOfWork`, (3) appends to the tamper-evident audit chain. Storage is injected,
  so the same app runs in-memory (demo) or against Postgres (production) unchanged.
- **`src/app/server.ts`**: a dependency-free Node `http` server exposing the app as REST and serving
  the web UI. Authentication is a demo shim — the `x-user-id` header selects a provisioned user,
  resolved to the real RBAC principal. In production this is replaced by SAML/OIDC; the authorization
  model downstream is identical.
- **`src/app/bootstrap.ts`**: provisions demo users and seeds the Northwind Work IQ leak through the
  real reconciliation path, so the running server demonstrates the moat (not a hardcoded row).

## Run paths

```bash
npm ci                 # install (lockfile is in sync; pg is optional and not required)
npm run serve:api      # live API + web UI on http://localhost:4173 (override with PORT=)
npm run demo:live      # boots the server, drives it over HTTP, prints the Work IQ proof
```

Open the served URL in a browser: the control room auto-detects the live API and hydrates from it,
posting decisions back to the backend (audited server-side). With the API down it falls back to
offline fixtures, so the UI always renders.

The control room has two tabs: **Case Inspector** (triage queue + evidence + approve/reject) and
**CFO Dashboard** (headline recoverable, annualized run-rate, projected recovery, peer-quartile
benchmark, ROI multiple + payback, and leakage-by-type). The dashboard is driven entirely by the
`/api/headline`, `/api/insights`, `/api/leakage-by-type`, and `/api/roi` endpoints.

### Demo users (set via `x-user-id` header; the web UI uses `cfo`)

| user        | roles      | scope        | can approve | can read audit |
|-------------|------------|--------------|-------------|----------------|
| `cfo`       | cfo        | all          | yes         | yes            |
| `controller`| controller | all          | yes         | yes            |
| `revops`    | revops     | northwind    | no (triage) | no             |
| `auditor`   | auditor    | all          | no          | yes            |
| `admin`     | admin      | all          | no          | no (manages)   |

## API surface

All endpoints are under `/api`. All except `/api/health` require the `x-user-id` header.

| method | path                              | permission        | description                          |
|--------|-----------------------------------|-------------------|--------------------------------------|
| GET    | `/api/health`                     | (none)            | liveness + tenant/currency           |
| GET    | `/api/cases`                      | case:read         | cases in the principal's scope       |
| GET    | `/api/cases/top?limit=N`          | case:read         | top-N by net recoverable             |
| GET    | `/api/cases/:id`                  | case:read         | one case (404 if absent/out of scope)|
| POST   | `/api/cases`                      | case:triage       | open a case from findings (201)      |
| POST   | `/api/cases/:id/decision`         | case:approve/reject | `{ decision: approve\|reject }`    |
| POST   | `/api/intent/ingest`              | case:read         | run Work IQ extractor on a document  |
| GET    | `/api/portfolio`                  | case:read         | summary + Work IQ attribution        |
| GET    | `/api/leakage-by-type`            | case:read         | leakage grouped by type              |
| GET    | `/api/period-close?from=&to=`     | audit:read        | period-close pack                    |
| GET    | `/api/audit`                      | audit:read        | audit entries + `intact` flag        |
| GET    | `/api/total-recoverable`          | case:read         | total net recoverable                |
| GET    | `/api/headline`                   | case:read         | dashboard hero: total, count, WIQ %  |
| GET    | `/api/insights`                   | case:read         | run-rate, projection, benchmark, maturity |
| POST   | `/api/roi`                        | case:read         | ROI calc from recoverable + cost inputs |
| GET    | `/api/anomalies`                  | case:read         | statistical outlier exposures        |
| GET    | `/api/evidence-pack?from=&to=`    | audit:read        | board/audit evidence bundle (hashed) |

Error mapping: missing/unknown user → 403; missing permission or out-of-scope → 403; unknown case →
404; malformed body / bad params → 400; unexpected error → 500. All errors return `{ error }` JSON.

### Example

```bash
curl -s localhost:4173/api/health
curl -s -H "x-user-id: cfo" localhost:4173/api/portfolio
curl -s -H "x-user-id: cfo" -H "content-type: application/json" \
  -X POST localhost:4173/api/cases/<id>/decision -d '{"decision":"approve"}'
curl -s -H "x-user-id: auditor" localhost:4173/api/audit   # check "intact": true
```

## Verification

```bash
npm run typecheck       # tsc, no errors
npm run test:coverage   # full suite (incl. integration) at 100% on all metrics
npm run test:frontend   # jsdom UI tests
npm run demo-offline    # deterministic moat proof (no server)
npm run demo:live       # moat proof over real HTTP
```

The standard `test`/`test:coverage` scripts now include `tests/integration/**`. The live HTTP path is
exercised by `tests/integration/server-live.test.ts` (binds an ephemeral port) and the in-process
handler by `tests/integration/server.test.ts` and `dispatch.test.ts`.

## Going to production

- Swap the in-memory `UnitOfWork` for the Postgres adapter (`src/persistence/postgres-adapter.ts`),
  run `npm run migrate`, and inject it into `bootstrap({ uow })`.
- Replace the `x-user-id` shim in `src/app/server.ts` with real IdP token validation; keep the RBAC
  principal resolution unchanged.
- Front the server with TLS termination and the webhook signing secret from a secrets manager.
