# THREAT_MODEL.md - RevenueTwin (STRIDE) (S85)

Per shared standard E.5: a STRIDE threat model with each mitigation mapped to a SPECIFIC test.
RevenueTwin moves no money autonomously; every material action is human-gated, reversible, and
audited. The deterministic engine - never the LLM - computes every figure and verdict.

## STRIDE table

| Threat | Category | Vector | Mitigation | Test |
|---|---|---|---|---|
| Forged identity / token | Spoofing | Fake/expired bearer token | Real OIDC/Entra RS256 verify vs JWKS (iss/aud/exp/nbf), demo shim only when unconfigured | src/identity/oidc.test.ts |
| Cross-tenant read | Information disclosure | User in tenant A reads tenant B | Tenant-scoped persistence + RBAC customer scoping | tests/negative/authz.test.ts |
| Audit-trail tampering | Tampering | Edit a recorded decision | Hash-chained tamper-evident audit; auditIntact verifies the chain | core/audit + auditIntact tests |
| Prompt injection in contract/email | Tampering / EoP | Malicious instructions embedded in an ingested span | Extractor reads structured signals only; injected instructions are inert; deterministic parser takes the real value not the injected one | tests/negative/prompt-injection.test.ts |
| Autonomous money movement | Elevation of privilege | Agent writes a correction without a human | No write without approval; human gate on 100% of money-moving actions; kill switch | remediation/action-layer + decision tests |
| Low-privilege escalation | Elevation of privilege | Reader performs a triage/approve action | requirePerm on every mutating app method (case:read vs case:triage vs approve) | tests/negative/authz.test.ts |
| Repudiation of a decision | Repudiation | User denies approving a write | Every successful action writes an actor-stamped audit event; chain is verifiable | functional audit tests |
| Duplicate webhook / double apply | Tampering | Replayed webhook causes double correction | Idempotent action layer keyed by action id | application + write-back tests |
| Malformed / hostile import | DoS / Tampering | Garbage CSV, mixed currencies, huge values | Row-level validation -> rejects with reasons; single-currency invariant per file | tests/negative/malformed-input.test.ts, importer tests |
| FX / locale confusion | Tampering | Wrong rate or rounding shifts the figure | Money in integer minor units; FX-rate-as-of-date; 100% money-math + taxonomy | money + consolidation tests |
| Secret leakage | Information disclosure | Credentials in repo | .env git-ignored; :? guards; deploy.sh rejects placeholder; secret scanning | deploy.sh + .gitignore |
| Fabricated figure from LLM | Tampering | A number originates from the model not the engine | LLM explains, engine decides; final values from deterministic core | reconciliation + guard tests |

## Residual risk + assumptions
- Live Microsoft Graph / Foundry IQ run behind least-privilege Entra scopes (see docs/M365_TENANT_SETUP.md); offline fallback is labelled, never presented as live.
- Postgres-at-scale and full Entra agent identities are documented seams (KNOWN_GAPS).
- The model sits behind an interface; the deterministic core is model-independent and tested as such.
