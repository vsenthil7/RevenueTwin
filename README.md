# RevenueTwin

**Enterprise Revenue Digital Twin & Revenue Assurance Operating System.**

RevenueTwin builds a continuously reconciled digital twin of an enterprise's revenue —
across contracts, CRM, billing, and *commercial intent* — detects revenue leakage with
deterministic money-math, and routes every recovery through a human-approved, fully
audited, reversible action layer. No autonomous money movement. Ever.

## Why it's different: the Work IQ moat

Traditional revenue-assurance tools reconcile structured systems (contracts ↔ billing ↔ CRM).
They are structurally blind to commercial commitments that live in *unstructured work* — the
verbal 12% uplift agreed in a QBR, the discount promised over email, the scope change in a
meeting that never reached an amendment.

RevenueTwin reaches that layer through **Work IQ**. The measurable claim, proven by the
`demo-offline` Golden Thread:

| | Work IQ OFF (blind) | Work IQ ON (sighted) |
|---|---|---|
| Northwind QBR-uplift leak detected | ❌ No | ✅ Yes |
| Net recoverable surfaced | £0.00 | £1,200.00 |
| Recall over intent-only leaks | 0% | 100% |

Run it yourself: `npm run demo-offline`.

## Architecture in one paragraph

A deterministic TypeScript core does all money-math in integer minor units (no floats).
A reconciliation engine compares expected vs. actual across four sources and produces scored
`VarianceFinding`s with a legal/temporal **net-recoverable** model. Work IQ corroborates
commercial intent and contributes intent-driven findings. Every finding becomes a
`LeakageCase` that a human triages; approved cases pass through an **idempotent, reversible,
race-resolving action layer** under SOX-style controls (segregation of duties, dual approval,
role limits). Everything is written to an append-only, **hash-chained audit log**. A web
control room and a Flutter mobile app provide the human surfaces.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout

```
src/        deterministic core (money, reconciliation, twin, intent, remediation, controls, api, agents)
web/        framework-free web control room (index.html + app.js)
mobile/     Flutter cross-platform app (lib/ + test/)
tests/      unit · functional · negative · e2e (jsdom executed + Playwright CI)
scripts/    demo-offline · seed · status · serve
docs/       architecture, threat model, agent specs, SOX mapping, ROI, deployment, security, admin
seed/       deterministic synthetic data + manifest
```

## Commands

| Command | What it does |
|---|---|
| `npm run test:coverage` | Backend unit+functional+negative with **100% coverage gate** |
| `npm run test:frontend` | jsdom E2E against the real web app (executes locally) |
| `npm run test:e2e` | Playwright web-desktop + web-mobile (CI; needs browser binary) |
| `npm run demo-offline` | Full Golden Thread, no network, prints the moat proof |
| `npm run seed` | Generate deterministic synthetic data + manifest |
| `npm run status` | System health / control / connector report |
| `(cd mobile && flutter test)` | Flutter unit + widget tests (CI; needs Flutter SDK) |

A `Makefile` wraps these with the spec's conventions: `make help` lists targets, `make demo-offline`
runs the moat proof, and `make ci-local` runs everything that doesn't need browser/Flutter binaries
(typecheck → 100% coverage gate → jsdom E2E → offline demo).

## Test status

- **Backend:** 534 tests, 100% line/branch/function/statement coverage — executed.
- **Web jsdom E2E:** 27 tests — executed.
- **Web Playwright:** 10 specs × 2 device projects — CI-executed (browser binary).
- **Mobile Flutter:** 11 tests — CI-executed (Flutter SDK).

See [SPRINT_TRACKER.md](SPRINT_TRACKER.md) and [KNOWN_GAPS.md](KNOWN_GAPS.md) for the
honest line between what runs in this build environment and what runs in CI.

## Non-negotiable invariants

1. **Deterministic money-math** — the model never computes money; the engine does, in integer minor units.
2. **No autonomous writes** — every external write requires an explicit human `approve` and is reversible.
3. **Tamper-evident audit** — every decision and write is hash-chained; `verify()` detects mutation.
4. **Work IQ is gated** — intent only acts through structured `upliftPercent` + `confidence`, never free text (see [docs/ROADMAP_AND_THREAT_MODEL.md](docs/ROADMAP_AND_THREAT_MODEL.md)).
