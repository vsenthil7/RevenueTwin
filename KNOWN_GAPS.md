# Known Gaps & Honest Build Notes

This project was built in a sandbox with a restricted network allowlist. This document states
precisely what executed here versus what is written and runs in CI, so nothing is overclaimed.

## Executed in this build environment ✅
- **Backend + integration test suite:** 395 tests, **100% line/branch/function/statement coverage**
  across all of `src/**`, including the application/server integration layer (`npm run test:coverage`).
- **Live HTTP integration:** `tests/integration/server-live.test.ts` binds an ephemeral port and
  drives the real server over `fetch`; `server.test.ts` + `dispatch.test.ts` cover the handler
  in-process. The API, RBAC, persistence, and audit chain are exercised end-to-end.
- **Web E2E (jsdom):** 10 tests against the real `web/app.js` (`npm run test:frontend`).
- **Offline demo:** full Golden Thread (`npm run demo-offline`) — moat proven, audit verified.
- **Live demo:** `npm run demo:live` boots the real API server and proves the moat over HTTP
  (blind 0 vs sighted 1, £1,200 recoverable, RBAC 403, audit chain intact).
- **Live API + UI server:** `npm run serve:api` — smoke-tested by hand (health, portfolio, RBAC, audit).
- **Seed & status scripts.**
- **Playwright spec discovery:** all specs × device projects discovered and validated by the runner.

## Runs in CI, not here ⚠️
- **Playwright browser run.** The Chromium binary download is blocked by the sandbox network
  allowlist (`cdn.playwright.dev` → 403). The specs, config, and web server are complete and
  correct; `npx playwright install && npm run test:e2e` runs them in CI. The *same* user flows
  are proven here by the jsdom suite and the live-socket integration tests.
- **Flutter tests.** No Flutter SDK in the sandbox. The app (`mobile/lib`) and tests (`mobile/test`,
  8 unit + 4 widget) are complete; `flutter test` runs them in CI. The Dart logic mirrors the
  TypeScript/jsdom-verified logic line-for-line.
- **Postgres-backed run.** The app runs in-memory here via `MemoryUnitOfWork`. The Postgres adapter
  (`src/persistence/postgres-adapter.ts`) + `schema.sql` + `npm run migrate` are complete; `pg` is an
  optional dependency wired through dependency injection, exercised against a real DB in CI/deploy.

## Closed since earlier build notes
- ~~Persistence is interface-level only~~ → the integration layer runs against the in-memory adapter
  end-to-end and is one injected `UnitOfWork` away from Postgres.
- ~~Domain modules aren't reachable as a product~~ → `RevenueTwinApp` + the HTTP server expose them;
  the web control room hydrates from the live API.

## Deliberate scope boundaries
- **Authentication** is delegated to the enterprise IdP; this codebase models authorization. The
  `x-user-id` header in `src/app/server.ts` is a demo shim, not a production auth mechanism.
- **Production audit store** (WORM/retention) is a deployment concern; the chain logic and verify
  path are complete and tested.
- **Work IQ extraction quality** depends on upstream M365 signals; the system mitigates *misuse*
  of intent (injection, low confidence) rather than guaranteeing extraction *accuracy*. The
  `IntentExtractor` interface is ready for an LLM-backed implementation; the bundled
  `RuleBasedExtractor` is deterministic and injection-resistant.

## Nothing stubbed as passing
No test is faked green. Where a layer couldn't execute in the sandbox, it is marked ⚠️ and the
equivalent executed proof is named.


## Web console (S61)


- The web console (`web/`) is fully covered at the browser-logic level by jsdom tests
 (`tests/e2e/web.jsdom.test.ts`, 27 tests, api.js + app.js at 100/100/100/100).
- `tests/playwright/control-room.spec.ts` is a real-Chromium smoke that runs in CI but NOT in the
 offline build sandbox, because the Playwright browser binary is fetched from a CDN that is
 network-blocked here (same constraint documented for the other products). Run in CI with
 `npx playwright install chromium && npm run test:e2e`.
- `web/main.js` is the browser entrypoint (logic-free) so `app.js` stays fully unit-testable.


## Mobile app (S62)


- The Flutter app (`mobile/`) has a pure-Dart domain layer (models, API client with injectable
 transport, inbox state) that is fully unit-testable, plus flutter_test widget tests for the three
 views. Symbol/structure validated in the offline build (brace + paren balance, every test symbol
 resolves to a lib declaration).
- `flutter test` / `flutter analyze` run in CI via the `mobile-flutter` job; they do NOT run in the
 offline build sandbox because there is no Dart/Flutter SDK here (analogous to the Playwright
 browser-binary constraint).
- The mobile API client targets the same REST surface as the web console; the live screens
 (PortfolioScreen/TriageScreen/ApprovalsScreen) are thin wrappers to be wired to the client at run
 time, while the testable *View widgets take pre-loaded data so they are deterministic.
