# Order Rescue — V1 rule contract

P05 contract revision **1.0.0**, source version **0.3.0**. This milestone contains specification and synthetic expected examples only; high_order_value is now implemented in P06A; high_line_quantity remains specification-only.

| Rule | Approved measurement | Match condition |
|---|---|---|
| `high_order_value` | `Order.currentTotalPriceSet.shopMoney.amount`, same `.currencyCode` as settings | exact decimal amount strictly greater than threshold |
| `high_line_quantity` | each `LineItem.currentQuantity` across complete pages | any individual quantity strictly greater than threshold; no summing lines |

Read [the two rule cards and shared contract](P05-RULE-CONTRACT.md) for applicability precedence, cancellation/refund behavior, access, evidence and versioning. [Synthetic inputs and expected outputs](fixtures/rules-v1.json) cover boundaries, invalid/unavailable input, currency, lifecycle and separate shop settings. They do not prove rule execution.

Canonical outcomes are `matched`, `not_matched`, `not_applicable`, `unknown`. Earlier `match`/`no_match` and config_version labels are superseded by the owner's requested contract names; numeric semantics are unchanged. Thresholds CAD100.00/quantity5 are fixtures, never universal defaults.

[Preserved earlier draft](RULES.pre-P05.md) retains historical alert lifecycle proposals and R01-R14 examples. Those examples are specifications, not passed runtime tests. Alert persistence, decisions and UI remain later milestones; no additional rule is introduced.


P06A reconciliation: only high_order_value is now implemented, preserving P05 semantics. Earlier no-rule statements describe prior milestones. See [implementation/evidence](P06A-HIGH-ORDER-VALUE.md); merchant settings/evaluation persistence remains absent, results are internal/transient. Next P06B; P04 live limitations remain.


P06B reconciliation (0.5.0): both accepted rules are implemented and tested, preserving contract 1.0.0. Earlier specification-only/quantity-unimplemented statements describe historical milestones. See [P06B evidence](P06B-LINE-QUANTITY.md). P07 local evaluator prerequisites pass; settings/results persistence and exceptions are still absent. Live P04 and production gates remain open.


P07 reconciliation (0.6.0): explicit shop settings, latest evaluations, stable exceptions and encrypted decision history now persist; earlier transient-only statements are historical. Terminal Resolve/Ignore decisions remain closed under automatic reevaluation. See [P07 lifecycle/evidence](P07-LIFECYCLE.md). P08 UI is next; no live migration/deployment or production-readiness claim.
