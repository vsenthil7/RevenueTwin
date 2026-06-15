# SEED_MANIFEST.md - planted-defect ground truth (S84)

Per shared standard A.5 / E.6: the synthetic seed is not just realistic, it is LABELLED. Every
planted leak below has a stable id, a ground-truth description, and the capability that should
detect it. The detection-metrics module (src/metrics/detection.ts) scores a detection run against
these ids to produce precision / recall / F1, gated against regression.

## Planted defects

| ID | Customer | Defect | Ground-truth value | Detecting capability | Work IQ only? |
|---|---|---|---|---|---|
| NW-QBR-UPLIFT | Northwind Traders | 10% price uplift agreed at the Mar-2026 QBR, never billed | ~GBP 1,200 net recoverable | Work IQ commercial-intent loop -> reconciliation | YES (vanishes when Work IQ off) |
| ACME-PRICE | Acme | Contracted price > billed price (price_changed) | expected-actual variance | deterministic reconciliation | no |
| GLOBEX-USAGE | Globex | Metered usage delivered but unbilled (unbilled_usage) | overage variance | deterministic reconciliation | no |

## Statistical-plausibility note
Seed amounts are in integer minor units (pence); currencies are valid ISO codes; every
CommercialIntentEvent references a real customer + term (referential integrity). The Northwind
case is the canonical Work-IQ-only leak used by the Golden Thread and the blind-vs-sighted test.

## How precision/recall is measured
`src/metrics/detection.ts` score(planted, detected): the planted set is the ID column above; the
detected set is the case/finding ids a run surfaces. The blind-vs-sighted test asserts
NW-QBR-UPLIFT is in `detected` only when Work IQ is on - i.e. recall for the Work-IQ-only class
drops to 0 with the source removed, which is the quantified moat delta on the dashboard + README.
