# Order Rescue — V1 rule contract

P05 contract revision **1.0.0**, source version **0.3.0**. This milestone contains specification and synthetic expected examples only; the rule evaluator is not implemented.

| Rule | Approved measurement | Match condition |
|---|---|---|
| `high_order_value` | `Order.currentTotalPriceSet.shopMoney.amount`, same `.currencyCode` as settings | exact decimal amount strictly greater than threshold |
| `high_line_quantity` | each `LineItem.currentQuantity` across complete pages | any individual quantity strictly greater than threshold; no summing lines |

Read [the two rule cards and shared contract](P05-RULE-CONTRACT.md) for applicability precedence, cancellation/refund behavior, access, evidence and versioning. [Synthetic inputs and expected outputs](fixtures/rules-v1.json) cover boundaries, invalid/unavailable input, currency, lifecycle and separate shop settings. They do not prove rule execution.

Canonical outcomes are `matched`, `not_matched`, `not_applicable`, `unknown`. Earlier `match`/`no_match` and config_version labels are superseded by the owner's requested contract names; numeric semantics are unchanged. Thresholds CAD100.00/quantity5 are fixtures, never universal defaults.

[Preserved earlier draft](RULES.pre-P05.md) retains historical alert lifecycle proposals and R01-R14 examples. Those examples are specifications, not passed runtime tests. Alert persistence, decisions and UI remain later milestones; no additional rule is introduced.
