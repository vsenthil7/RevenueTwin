# RevenueTwin — Architecture

## Principle: the engine decides, the LLM explains

RevenueTwin is a deterministic decision system with an explanatory intelligence layer. Money math
and pass/fail are computed by the engine in integer minor units; the Work IQ / LLM layer only
*proposes* commercial-intent signals that the deterministic reconciliation must still confirm. This
keeps every recovery reproducible, auditable, and defensible.

## Layers

```
  Unstructured sources        Structured sources
  (QBR notes, email, CRM)     (contracts, billing, CRM, usage)
          |                            |
     Work IQ extraction          Connectors + normalize
     (intent signals)            (typed records)
          \\__________________________/
                       |
               Reconciliation engine
        (expected vs actual, net-recoverable legal model)
                       |
                 VarianceFinding[]
                       |
                  LeakageCase  --- human triage (RBAC + scope)
                       |
             Remediation action layer
       (idempotent, reversible, SoD, dual approval)
                       |
            Tamper-evident audit (SHA-256 chain)
```

## Modules (`src/`)

- **money/** — integer-minor-unit money type; all arithmetic, no floats.
- **core/model** — Customer, Contract, Invoice, VarianceFinding, LeakageCase, TwinState.
- **core/reconciliation** — expected-vs-actual comparison; net-recoverable legal/temporal model.
- **core/twin** — validated, audited revenue-twin state machine.
- **core/audit** — append-only SHA-256 hash chain; `verifyChain` detects any mutation.
- **core/golden-thread** — the Northwind moat scenario used by the demos.
- **intent/** — Work IQ: commercial-intent extraction + intent-driven variance input.
- **remediation/** — propose -> approve -> execute -> reverse action layer.
- **persistence/** — UnitOfWork over in-memory (dev/test) or Postgres (prod); injectable PgClient.
- **identity/** — RBAC (roles, permissions, customer scope) + the auth/verifyToken seam.
- **app/** — application facade (authZ + persistence + audit per call), HTTP server, bootstrap.
- plus the full revenue domain: consolidation, allocation, anomaly, dataquality, forecast, churn,
  policy, tenancy, disputes, metrics, usage, amendments, benchmarking, scheduler, webhooks, tax,
  evidence, contracts, revrec, detectors, partners, journal, segments, alerts, workflow,
  reporting/analytics, bulk operations.

## Surfaces

- **REST API** (`src/app/server.ts`): bearer-token auth seam, full route table, AppError -> HTTP.
- **Web control room** (`web/`): leakage queue, Work IQ toggle, inspector, CFO dashboard; live API
  hydration with offline-fixture fallback.
- **Mobile** (`mobile/`): Flutter app — CFO portfolio, case triage, approval inbox.

## Determinism & testability

Every module uses injectable clocks, in-memory stores, and mocked transports, so the whole system
runs offline and deterministically. The non-app `src` tree and the app layer are held at 100%
coverage across lines, branches, functions and statements; `src/app/demo-live.ts` (a runnable HTTP
demo entrypoint) is the sole exclusion from the gate.

## Trust boundary

See [ROADMAP_AND_THREAT_MODEL.md](ROADMAP_AND_THREAT_MODEL.md) for the STRIDE model and the
prompt-injection / LLM trust boundary, and [DEPLOYMENT.md](DEPLOYMENT.md) for the security posture.
