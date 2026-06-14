# RevenueTwin - Product Roadmap and Competitive Plan (S65+)

Focus: turn a technically-deep engine into a product a CFO buys. Every sprint below is scored by one question: does this move us closer to a signed pilot?

## Competitive landscape - how we win

Traditional revenue-assurance tools and home-grown finance spreadsheets share three weaknesses:

- Structured-only: they reconcile contract vs billing vs CRM. They are blind to commitments made in unstructured work (QBR transcripts, email, meetings). Our Work IQ moat is exactly this gap.
- Black-box numbers: they assert a recoverable figure with no defensible provenance. Our deterministic engine + hash-chained audit + legal/temporal decay gives every pound a paper trail.
- Autonomous or manual extremes: either they auto-adjust (scary for finance) or they are just a report. We sit in the middle: human-gated, reversible, SOX-style controls.

Our wedge: a CFO uploads their own data and sees their own recoverable revenue in under 2 minutes, with a defensible audit trail, behind real login.


## Block U - Scale and stickiness (S77+, future mini-sprints)

Once a pilot is live and differentiated, these deepen the moat and make the product hard to leave:

**S77 - Recovery workflow + dunning export.** Beyond detecting a leak: generate the actual recovery
action (credit memo / rebill draft / dunning letter) for an approved case, exportable to the billing
team. Closes the loop from detection to cash.

**S78 - Slack/Teams + email alert delivery.** Wire the S73 scheduled-rescan alerts to real channels
(the webhooks module exists) so new leakage reaches a human where they already work.

**S79 - Benchmark + peer percentile dashboard.** Surface the benchmarking engine: show a CFO where
their leakage rate sits vs peer quartiles. Turns a number into a narrative the board cares about.

**S80 - What-if / scenario modelling.** Let a CFO model the revenue impact of a pricing or escalator
change against their actual portfolio before committing - forecasting engine already exists.

**S81 - Audit-pack PDF export + board deck.** One-click, signed evidence pack and board-ready deck
from any import run or period (evidence module exists; add rendered export).

**S82 - API keys + programmatic ingestion.** Let a customer push data continuously via an API key
(beyond file/connector), so RevenueTwin becomes part of their close process rather than a one-off.

Sequencing: S77-S78 deepen the close-the-loop value; S79-S80 are the board-level narrative; S81-S82
make it operationally sticky. None are needed to win the first pilot, but each raises switching cost.
