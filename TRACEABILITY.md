# RevenueTwin — Requirements Traceability Matrix

Maps each enterprise requirement → the module that satisfies it → the sprint that delivered it →
its test artifact → execution status. Updated at the end of every sprint, before the next begins.

**Status legend:** ✅ done & executed here · 🔄 in progress · ⬜ planned · 🟡 CI-only (binary/SDK absent here)

## Block R provenance note
The repository as delivered (V01–V12 zips) contained ~48 domain files but was **missing the
foundation they import** and **all tests/web/mobile**. Block R (S47–S62) reconstructs the
foundation, assembles the `src/` tree, and re-establishes every test at 100% — executed and
committed in THIS repository. Rows below marked `(present, unwired)` were delivered as source but
could not compile until their imports existed; Block R wires and tests them.

---

## 1. Foundation requirements

| Req ID | Requirement | Module | Sprint | Test artifact | Status |
|---|---|---|---|---|---|
| F-01 | Money is exact integer minor units; no float drift | `src/money/money.ts` | S47 | `tests/unit/money.test.ts` (28 tests, 100%) | ✅ |
| F-02 | Canonical revenue domain model | `src/core/model.ts` | S48 | `tests/unit/model.test.ts` (7, 100%) | ✅ |
| F-03 | Tamper-evident append-only audit (SHA-256 chain) | `src/core/audit.ts` | S49 | `tests/unit/audit.test.ts` (12, 100%) | ✅ |
| F-04 | Deterministic reconciliation decides pass/fail (never an LLM) | `src/core/reconciliation.ts` | S50 | `tests/unit/reconciliation.test.ts` (18, 100%) | ✅ |
| F-05 | 8-state revenue-twin machine, audited transitions | `src/core/twin.ts` | S51 | `tests/unit/twin.test.ts` (12, 100%) | ✅ |
| F-06 | Work IQ commercial-intent moat; blind-vs-sighted recall delta | `src/intent/workiq.ts` + `src/core/golden-thread.ts` | S52 | `tests/functional/workiq.test.ts` (12, 100%) | ✅ |
| F-07 | Idempotent reversible action layer | `src/remediation/action-layer.ts` | S53 | `tests/unit/action-layer.test.ts` (12, 100%) | ✅ |
| F-08 | Connector platform registry + health/mode | `src/api/platform.ts` | S53 | `tests/unit/platform.test.ts` (11, 100%) | ✅ |

## 2. Persistence & multi-tenancy

| Req ID | Requirement | Module | Sprint | Test artifact | Status |
|---|---|---|---|---|---|
| P-01 | Storage-agnostic repository contracts | `src/persistence/repository.ts` | S13→S55 | `tests/unit/persistence.test.ts` (19, 100%) | ✅ |
| P-02 | In-memory adapter (pilots/tests/demo) | `src/persistence/memory-adapter.ts` | S13→S55 | `tests/unit/persistence.test.ts` | ✅ |
| P-03 | Postgres adapter, tenant-scoped, append-only DB trigger | `src/persistence/postgres-adapter.ts` | S13→S55 | `tests/unit/persistence.test.ts` | ✅ |
| P-04 | **Postgres is the default in production** | `src/app/bootstrap.ts` | S59 | `tests/functional/persistence-default.test.ts` | ⬜ |

## 3. Identity, authZ, authN

| Req ID | Requirement | Module | Sprint | Test artifact | Status |
|---|---|---|---|---|---|
| I-01 | Deny-by-default RBAC, 7 roles, customer scoping | `src/identity/rbac.ts` | S17→S55 | `tests/unit/rbac.test.ts` (13, 100%) | ✅ |
| I-02 | **Real auth seam (OIDC/Entra `verifyToken`)**, not header shim | `src/identity/auth.ts` (new) + `src/app/server.ts` | S60 | `tests/negative/auth.test.ts` | ⬜ |

## 4. Domain breadth (delivered modules — wired & tested in Block R)

| Req ID | Requirement | Module | Sprint | Status |
|---|---|---|---|---|
| D-01 | Connector ingestion + normalization | `src/connectors/*` | S14→S55 | `tests/unit/connectors.test.ts` (22, 100%) | ✅ |
| D-02 | Work IQ extraction (rule + LLM seam) | `src/intent/extraction.ts` | S15→S55 | `tests/unit/extraction.test.ts` (12, 100%) | ✅ |
| D-03 | Billing write-back (credit note / corrected line) | `src/billing/write-back.ts` | S16→S55 | `tests/unit/billing.test.ts` (9, 100%) | ✅ |
| D-04 | Reporting / CFO analytics | `src/reporting/analytics.ts` | S19→S55 | ⬜ (present, unwired) |
| D-05 | Bulk operations & scale | `src/bulk/operations.ts` | S20→S55 | ⬜ (present, unwired) |
| D-06 | Multi-currency consolidation | `src/consolidation/fx-consolidation.ts` | S21→S56 | `tests/unit/fx-consolidation.test.ts` (8, 100%) | ✅ |
| D-07 | Forecasting & at-risk revenue | `src/forecasting/forecast.ts` | S22→S56 | `tests/unit/forecast.test.ts` (12, 100%) | ✅ |
| D-08 | Anomaly detection (z-score + MAD) | `src/anomaly/detection.ts` | S23→S56 | `tests/unit/anomaly.test.ts` (13, 100%) | ✅ |
| D-09 | Dispute & negotiation management | `src/disputes/negotiation.ts` | S24→S56 | `tests/unit/negotiation.test.ts` (10, 100%) | ✅ |
| D-10 | Approval policy engine | `src/policy/approval-policy.ts` | S25→S56 | `tests/unit/approval-policy.test.ts` (6, 100%) | ✅ |
| D-11 | Observability & operational metrics | `src/observability/metrics.ts` | S26→S56 | `tests/unit/metrics.test.ts` (10, 100%) | ✅ |
| D-12 | Data quality & lineage scoring | `src/dataquality/scoring.ts` | S27→S56 | `tests/unit/dataquality.test.ts` (10, 100%) | ✅ |
| D-13 | Tenant config & entitlements | `src/tenancy/config.ts` | S28→S56 | `tests/unit/tenancy.test.ts` (10, 100%) | ✅ |
| D-14 | Usage / consumption billing | `src/usage/consumption.ts` | S29→S56 | `tests/unit/consumption.test.ts` (15, 100%) | ✅ |
| D-15 | Contract amendment diffing | `src/amendments/diff.ts` | S30→S56 | `tests/unit/amendments.test.ts` (8, 100%) | ✅ |
| D-16 | Peer benchmarking | `src/benchmarking/peer-benchmark.ts` | S31→S56 | `tests/unit/peer-benchmark.test.ts` (8, 100%) | ✅ |
| D-17 | Evidence pack generation | `src/evidence/evidence-pack.ts` | S32→S56 | `tests/unit/evidence-pack.test.ts` (5, 100%) | ✅ |
| D-18 | Scheduler (recurring jobs, backoff) | `src/scheduler/scheduler.ts` | S33→S56 | `tests/unit/scheduler.test.ts` (10, 100%) | ✅ |
| D-19 | Production webhook delivery (HMAC, DLQ) | `src/webhooks/delivery.ts` | S34→S56 | `tests/unit/webhook-delivery.test.ts` (10, 100%) | ✅ |
| D-20 | Tax & jurisdiction engine | `src/tax/jurisdiction.ts` | S35→S56 | `tests/unit/tax.test.ts` (8, 100%) | ✅ |
| D-21 | Contract lifecycle (ramp, co-term) | `src/contracts/lifecycle.ts` | S36→S56 | `tests/unit/lifecycle.test.ts` (10, 100%) | ✅ |
| D-22 | Revenue recognition (ASC 606 / IFRS 15) | `src/revrec/recognition.ts` | S37→S56 | `tests/unit/recognition.test.ts` (12, 100%) | ✅ |
| D-23 | Transaction-price allocation | `src/allocation/transaction-price.ts` | S38→S56 | `tests/unit/transaction-price.test.ts` (9, 100%) | ✅ |
| D-24 | Churn & expansion (NRR/GRR) | `src/churn/retention.ts` | S39→S56 | `tests/unit/churn.test.ts` (6, 100%) | ✅ |
| D-25 | Safe leakage-detector DSL (no eval) | `src/detectors/dsl.ts` | S40→S56 | `tests/unit/dsl.test.ts` (10, 100%) | ✅ |
| D-26 | Partner / reseller revenue splits | `src/partners/revenue-split.ts` | S41→S56 | `tests/unit/revenue-split.test.ts` (11, 100%) | ✅ |
| D-27 | Double-entry journal postings | `src/journal/entries.ts` | S42→S56 | ⬜ (present, unwired) |
| D-28 | Customer segmentation | `src/segmentation/segments.ts` | S43→S56 | ⬜ (present, unwired) |
| D-29 | Alerting & thresholds (hysteresis) | `src/alerts/alerting.ts` | S44→S56 | ⬜ (present, unwired) |
| D-30 | Workflow & notifications (SLA) | `src/workflow/engine.ts` | S18→S56 | ⬜ (present, unwired) |

## 5. Integration & product surface

| Req ID | Requirement | Module | Sprint | Test artifact | Status |
|---|---|---|---|---|---|
| A-01 | Unified app facade (authZ + persistence + audit per call) | `src/app/application.ts` | S45→S57 | `tests/functional/application.test.ts` | ⬜ (present, unwired) |
| A-02 | HTTP REST server + static UI | `src/app/server.ts` | S45→S57 | `tests/functional/server.test.ts` | ⬜ (present, unwired) |
| A-03 | Bootstrap / demo provisioning through real path | `src/app/bootstrap.ts` | S45→S59 | `tests/functional/bootstrap.test.ts` | ⬜ (present, unwired) |
| A-04 | Insights service (ROI, benchmark, anomalies) | `src/app/insights.ts` | S46→S57 | `tests/functional/insights.test.ts` | ⬜ (present, unwired) |

## 6. Front end

| Req ID | Requirement | Module | Sprint | Test artifact | Status |
|---|---|---|---|---|---|
| W-01 | Web control room + CFO dashboard, live API hydration | `web/app.js`, `web/api.js` | S61 | `tests/e2e/*.jsdom.test.ts` (100%, here) | ⬜ |
| W-02 | Playwright E2E — desktop + mobile viewports | `tests/e2e/*.pw.spec.ts` | S61 | Playwright (CI) | ⬜ |
| M-01 | Flutter mobile app (portfolio, triage, approvals) | `mobile/**` | S62 | `mobile/test/**` (CI) | ⬜ |

## 7. Testing automation contract

| Req ID | Requirement | Sprint | Status |
|---|---|---|---|
| T-01 | Backend unit coverage 100% (line/branch/function/statement) | S55–S56 | ⬜ |
| T-02 | Functional coverage 100% of documented flows | S57 | ⬜ |
| T-03 | Negative coverage 100% of failure/adversarial paths | S58 | ⬜ |
| T-04 | Front-end (web) logic coverage 100% via jsdom (executes here) | S61 | ⬜ |
| T-05 | Playwright web E2E green in CI (desktop + mobile) | S61 | ⬜ |
| T-06 | Flutter mobile tests green in CI | S62 | ⬜ |
| T-07 | `make ci-local` green here (tsc + 100% + jsdom + offline demo) | S62 | ⬜ |
