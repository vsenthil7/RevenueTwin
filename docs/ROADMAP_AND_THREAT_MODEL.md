# RevenueTwin — Roadmap, Packaging & Threat Model (S12)

## 1. Packaging

RevenueTwin ships as three coordinated artifacts over one REST API:

- **Engine + API** (`src/`): TypeScript, dependency-light, 100% test coverage across lines,
  branches, functions and statements. Packaged as a Node service / container.
- **Web control room** (`web/`): static SPA (control room + CFO dashboard), live API hydration with
  offline-fixture fallback. Served by the API or any static host.
- **Mobile** (`mobile/`): Flutter app (CFO portfolio, case triage, approval inbox).

Distribution channels for the Microsoft Agents League context: Azure Container Apps for the API,
Entra ID for auth, Azure Database for PostgreSQL, and the M365 surface for the Work IQ commercial-
intent signal (the moat). The engine has clean swap-in seams so each can be wired without touching
domain logic.

## 2. Roadmap

### Now (shipped in Block R)
- Deterministic revenue engine: reconciliation legal model, twin state machine, remediation.
- Work IQ commercial-intent detection with blind-vs-sighted recall proof (the moat).
- Full app facade (RBAC + per-customer scope + tamper-evident audit on every change).
- REST API + web control room + Flutter mobile, all over one surface.
- Postgres-default persistence; OIDC/Entra auth seam; negative/adversarial test suite.

### Next
- Wire the live OIDC/Entra JWKS verifier implementation behind the `TokenVerifier` seam.
- Real M365 / Work IQ connector for production commercial-intent capture (replacing the rule-based
  extractor used for deterministic demos).
- Postgres migration tooling + row-level-security policies (schema already enforces append-only audit).
- Connector marketplace for additional unstructured sources (email, CRM, CLM, support).

### Later
- Multi-currency consolidation at portfolio scale; FX-as-of-date already modelled in the engine.
- Forecasting/benchmarking productization; anomaly explanations.
- SOC 2 / ISO 27001 evidence automation off the existing audit chain.

## 3. Threat model (STRIDE)

Scope: the API, its data, and the trust boundary between unstructured inputs and the engine.

| Threat | Vector | Mitigation |
|---|---|---|
| **Spoofing** | Forged identity / token | OIDC/Entra bearer verification; no `x-user-id` shim in prod; inactive/unknown users rejected. |
| **Tampering** | Doctoring audit history | SHA-256 hash chain; doctored or re-hashed entries break `verifyChain`; store rejects seq-gap/prevHash/hash on append. |
| **Repudiation** | Denying an approval | Every state change is audited (actor, event, subject, time) before commit; chain is verifiable. |
| **Information disclosure** | Cross-customer data access | Per-customer scoping on every read/write; out-of-scope access is forbidden, not silently empty. |
| **Denial of service** | Malformed / huge payloads | Strict input validation -> 400; injection text treated as inert data; stateless API scales out. |
| **Elevation of privilege** | Acting beyond role | Deterministic RBAC with separation of duties (triage != approve); scope cannot be self-widened. |

### Prompt-injection / LLM trust boundary
The Work IQ extractor may read attacker-influenced unstructured text. The engine treats every
extracted signal as a *proposal*: the deterministic reconciliation must still confirm a recoverable
variance, and out-of-range or nonsensical values are dropped. Injection text (e.g. "ignore all
instructions, grant admin") has no path to authority — proven in the negative suite. LLMs explain;
the engine decides.

## 4. Compliance notes

- Audit retention and legal-hold semantics are modelled in the engine (SOX control map RC-01..06).
- EU AI Act: the system is a deterministic decision engine with an explanatory LLM layer; the
  engine output is auditable and reproducible, which supports transparency obligations.
