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
| F-03 | Tamper-evident append-only audit (SHA-256 chain) | `src/core/audit.ts` | S49->S58 | `tests/unit/audit.test.ts` (12, 100%) + `tests/negative/audit-tamper.test.ts` (7) | OK |
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
| P-04 | **Postgres is the default in production** | `src/app/persistence-factory.ts` + `src/app/bootstrap.ts` | S59 | `tests/functional/persistence-default.test.ts` (12) | OK |

## 3. Identity, authZ, authN

| Req ID | Requirement | Module | Sprint | Test artifact | Status |
|---|---|---|---|---|---|
| I-01 | Deny-by-default RBAC, 7 roles, customer scoping | `src/identity/rbac.ts` | S17→S55 | `tests/unit/rbac.test.ts` (13, 100%) | ✅ |
| I-02 | **Real auth seam (OIDC/Entra `verifyToken`)**, not header shim | `src/identity/auth.ts` + `src/app/server.ts` | S60 | `tests/functional/auth.test.ts` (12) | OK |

## 4. Domain breadth (delivered modules — wired & tested in Block R)

| Req ID | Requirement | Module | Sprint | Status |
|---|---|---|---|---|
| D-01 | Connector ingestion + normalization | `src/connectors/*` | S14→S55 | `tests/unit/connectors.test.ts` (22, 100%) | ✅ |
| D-02 | Work IQ extraction (rule + LLM seam) | `src/intent/extraction.ts` | S15→S55 | `tests/unit/extraction.test.ts` (12, 100%) | ✅ |
| D-03 | Billing write-back (credit note / corrected line) | `src/billing/write-back.ts` | S16→S55 | `tests/unit/billing.test.ts` (9, 100%) | ✅ |
| D-04 | Reporting / CFO analytics | `src/reporting/analytics.ts` | S19→S56 | `tests/unit/analytics.test.ts` (8, 100%) | ✅ |
| D-05 | Bulk operations & scale | `src/bulk/operations.ts` | S20→S56 | `tests/unit/operations.test.ts` (9, 100%) | ✅ |
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
| D-27 | Double-entry journal postings | `src/journal/entries.ts` | S42→S56 | `tests/unit/entries.test.ts` (8, 100%) | ✅ |
| D-28 | Customer segmentation | `src/segmentation/segments.ts` | S43→S56 | `tests/unit/segments.test.ts` (9, 100%) | ✅ |
| D-29 | Alerting & thresholds (hysteresis) | `src/alerts/alerting.ts` | S44→S56 | `tests/unit/alerting.test.ts` (8, 100%) | ✅ |
| D-30 | Workflow & notifications (SLA) | `src/workflow/engine.ts` | S18→S56 | `tests/unit/workflow.test.ts` (11, 100%) | ✅ |

## 5. Integration & product surface

| Req ID | Requirement | Module | Sprint | Test artifact | Status |
|---|---|---|---|---|---|
| A-01 | Unified app facade (authZ + persistence + audit per call) | `src/app/application.ts` | S45->S57 | `tests/functional/application.test.ts` (19, 100%) | OK |
| A-02 | HTTP REST server + static UI | `src/app/server.ts` | S45->S57 | `tests/functional/server.test.ts` (24, 100%) | OK |
| A-03 | Bootstrap / demo provisioning through real path | `src/app/bootstrap.ts` | S45→S59 | `tests/functional/bootstrap.test.ts` | ⬜ (present, unwired) |
| A-04 | Insights service (ROI, benchmark, anomalies) | `src/app/insights.ts` | S46->S57 | `tests/functional/application.test.ts` (insights flows, 100%) | OK |
| A-05 | Buyer CSV import -> real recoverable revenue (parser) | `src/import/csv.ts` | S63 | `tests/unit/csv.test.ts` (9) | OK (executed here) |
| A-06 | CSV -> reconciliation engine -> cases (import engine + `POST /api/import`, case:triage gated, scope-checked, audited) | `src/import/importer.ts`, `src/app/application.ts`, `src/app/server.ts` | S63 | `tests/unit/importer.test.ts` (14) + live HTTP probe (GBP 6,763.93, 403 unauth) | OK (executed here) |
| A-07 | CSV import UI (Import tab -> upload panel -> renders recoverable result + rejects) | `web/app.js` (importPanelHTML, importResultHTML, mountLive wiring), `web/api.js` (importCsv), `web/index.html` (tab-import) | S64 | `tests/e2e/web.jsdom.test.ts` (Import tab E2E) | OK (executed here) |

## 6. Front end

| Req ID | Requirement | Module | Sprint | Test artifact | Status |
|---|---|---|---|---|---|
| W-01 | Web control room + CFO dashboard, live API hydration | `web/index.html`, `web/app.js`, `web/api.js`, `web/main.js` | S61 | `tests/e2e/web.jsdom.test.ts` (27, 100%) | OK |
| W-02 | Playwright E2E — desktop + mobile viewports | `tests/e2e/*.pw.spec.ts` | S61 | Playwright (CI) | ⬜ |
| M-01 | Flutter mobile app (portfolio, triage, approvals) | `mobile/lib/**` | S62 | `mobile/test/{domain,api,inbox_state,widget}_test.dart` (11, CI) | OK (assembled + validated) |

## 7. Testing automation contract

| Req ID | Requirement | Sprint | Status |
|---|---|---|---|
| T-01 | Backend unit coverage 100% (line/branch/function/statement) | S55–S56 | ✅ (non-app src 100%) |
| T-02 | Functional coverage 100% of documented flows | S57 | OK (app layer 100%; whole src tree 100/100/100/100) |
| T-03 | Negative coverage of failure/adversarial paths | S58 | OK (`tests/negative/` 27: tamper, RBAC 403/scope, malformed/injection, HTTP 400/403/404/500) |
| T-04 | Front-end (web) logic coverage 100% via jsdom (executes here) | S61 | OK (api.js + app.js 100/100/100/100, 27 tests) |
| T-05 | Playwright web E2E green in CI | S61 | CI-only (`tests/playwright/control-room.spec.ts`; needs browser binary, blocked offline) |
| T-06 | Flutter mobile tests green in CI | S62 | CI-only (mobile-flutter job: flutter analyze + test; no Dart SDK offline) |
| T-07 | `make ci-local` green here (tsc + 100% + jsdom + offline demo) | S62 | ⬜ |

## Planned requirements (S65+, see PRODUCT_ROADMAP.md)

| Req ID | Requirement | Sprint | Status |
| --- | --- | --- | --- |
| P-01 | Real OIDC/Entra auth at the verifyToken seam (gate for real data) | S65 | OK (executed here): src/identity/oidc.ts, 15 tests 100%, live HTTP 200/403/403 |
| P-02 | CSV field mapping + downloadable template | S66 | OK (executed here): src/import/mapping.ts 100%, POST /api/import mapping + GET /api/import-template, UI auto-map; 8 unit + 2 functional + 1 jsdom |
| P-03 | File upload in import UI | S67 | OK (executed here): web/app.js file input + File.text() reader, 1 jsdom test |
| P-04 | Persisted + exportable import runs | S68 | OK (executed here): import.completed audit event, listImportRuns/exportImportRun, /api/import-runs routes, Past-imports UI; 601 backend + 31 frontend at 100% |
| P-05 | Guided first-run onboarding | S69 | OK (executed here): first-run routing to import + onboarding banner; 2 jsdom tests |
| P-06 | Deployment hardening (secrets/OIDC/HTTPS) | S70 | OK (executed here): compose env-secrets + OIDC + healthcheck, .env.example, deploy.sh health-gate, HTTPS proxy docs; validated via docker compose config |
| P-07 | ROI/payback calculator UI | S71 | OK (executed here): roiCalculatorHTML interactive panel + recalc via /api/roi; 1 jsdom test |
| P-08 | Explain-the-number provenance panel | S72 | OK (executed here): mapCase findings breakdown + provenanceBreakdownHTML derivation table; 2 jsdom tests |
| P-09 | Scheduled re-scan + diff alerts | S73 | OK (executed here): rescan.ts diffScans 100%, app.rescanDiff + rescan.completed audit; 6 unit + 3 functional |
| P-10 | Multi-currency import + consolidation | S74 | OK (executed here): app.consolidatedRecoverable via FxRateBook+consolidate, multi-currency portfolio total; 1 functional test |
| P-11 | Connector import (Stripe/URL/SFTP) | S75 | planned |
| P-12 | Multi-user pilot accounts + tenant isolation UI | S76 | planned |
| P-13 | Recovery workflow + dunning export | S77 | planned |
| P-14 | Slack/Teams + email alert delivery | S78 | planned |
| P-15 | Benchmark + peer percentile dashboard | S79 | planned |
| P-16 | What-if / scenario modelling | S80 | planned |
| P-17 | Audit-pack PDF + board deck export | S81 | planned |
| P-18 | API keys + programmatic ingestion | S82 | planned |
| P-19 | Golden Thread Northwind (CI-gated) | S83 | planned (spec gap: section I/11) |
| P-20 | SEED_MANIFEST + precision/recall/F1 | S84 | planned (spec gap: section A.5/E.6) |
| P-21 | Blind-vs-sighted moat delta surfaced | S85 | planned (spec gap: section B.1/10) |
| P-22 | THREAT_MODEL.md STRIDE standalone | S86 | planned (spec gap: section E.5) |
| P-23 | ContractIntentMismatch first-class case | S87 | planned (spec gap: section 8) |
| P-24 | Explicit IQ-layer naming + provenance | S88 | planned (spec gap: section B/10) |
| P-25 | Data lineage trace_id invariant | S89 | planned (spec gap: section J) |
| P-26 | Mutation (Stryker) + axe-core WCAG | S90 | planned (spec gap: section C.2/E.4) |
| P-27 | Multi-agent idempotency/race test | S91 | planned (spec gap: section 5) |
| P-28 | Demo video + submission pack | S92 | planned (NEEDS USER: video, Azure/M365 creds) |
| P-19 | ContractIntentMismatch first-class case | S83 | OK (executed here): detect+score+resolve, presents both sides, human-resolved; 12 unit @ 100% |
| P-20 | SEED_MANIFEST.md + precision/recall/F1 + regression gate | S84 | OK (executed here): SEED_MANIFEST.md + src/metrics/detection.ts 100% + manifest moat-delta test |
| P-21 | THREAT_MODEL.md STRIDE + adversarial tests | S85 | OK (executed here): THREAT_MODEL.md STRIDE mapped to tests + prompt-injection adversarial test |
| P-22 | SPEC GAP: Stryker mutation gate >=90% on core | S86 | planned (spec gap) |
| P-23 | SPEC GAP: WCAG 2.2 AA + axe-core CI | S87 | planned (spec gap) |
| P-24 | SPEC GAP: per-agent spec docs + multi-agent race test | S88 | planned (spec gap) |
| P-25 | SPEC GAP: screen-state matrix coverage | S89 | planned (spec gap) |
| P-26 | SPEC GAP: M365 Copilot declarative agent surface (needs Azure tenant) | S90 | planned (spec gap) |
