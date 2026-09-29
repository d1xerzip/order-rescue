# P05 — two V1 rule cards and shared result contract

Contract revision **1.0.0**; source milestone **0.3.0**. Specification and synthetic examples only: no evaluator, settings persistence, alerts or rule execution implemented. Exactly two rule keys: `high_order_value`, `high_line_quantity`.

## Reconciliation and decisions

The existing current-total, shop-currency, strictly-greater, per-line, cancellation and coverage semantics are preserved. The owner's requested outcome names replace earlier draft `match` / `no_match` with `matched` / `not_matched`; `config_version` becomes `settingsVersion`. No stored rule results exist to migrate. CAD100 and quantity5 are fixtures, not new merchant defaults; earlier1000/10 examples remain valid examples. No material product-policy divergence requiring owner confirmation was found. Refund details below clarify the selected API field rather than changing the measured value.

Both rules start disabled/unconfigured. No fraud labels, address claims, probability or severity scores, currency conversion, new scopes or identifying fields. Previous alert-lifecycle proposals remain deferred to P07; this contract does not implement them.

## Input and applicability (ordered)

Inputs are the verified server tenant and installation generation, evaluation time, monitoring start, normalized source snapshot with explicit availability, an immutable sourceSnapshotVersion, and a versioned configuration for this rule and shop. SourceSnapshotVersion is a proposed digest/revision of the exact normalized snapshot, not `updatedAt` alone; P04 demonstrated that equal timestamps can contain different values. This metadata needs no extra Shopify field. The JSON examples use synthetic revision labels.

Authorization is a boundary, not a fifth result: a foreign shop/settings/order identity is rejected before evaluation, with no foreign evidence. The fixture set includes a separate rejected-request example. Merchant input must never select the trusted tenant.

Within an authorized input, apply this precedence before comparing numbers:

1. Missing settings -> `not_applicable / NOT_CONFIGURED`, settingsVersion null. Explicit enabled=false -> `not_applicable / RULE_DISABLED` even if unused numeric fields are invalid.
2. Inactive installation or old generation -> `not_applicable / INACTIVE_INSTALLATION`.
3. Known non-null cancelledAt -> `not_applicable / ORDER_CANCELLED`. Known creation before monitoring start or at/after creation+30days expiry -> `not_applicable / OUTSIDE_MONITORING_WINDOW`. Exact monitoring start is included; exact expiry is excluded.
4. If cancellation, creation time, or other required applicability metadata is unavailable -> `unknown / ELIGIBILITY_UNAVAILABLE`; malformed/future creation time -> `unknown / INVALID_DATA`. A known exclusion from step3 is sufficient even if another eligibility field is unavailable.
5. Settings must have boolean enabled, a valid immutable version and threshold (plus currency for value): otherwise `unknown / INVALID_CONFIGURATION`. A valid version is a non-empty string of letters, digits, dot, colon, underscore or hyphen (maximum128 characters); missing/malformed versions are returned as null, never echoed. Future settings writes must reject invalid input rather than save it; these fixtures cover corrupt/imported configuration defensively.
6. Check only this rule's required data availability and validity, then compare. A failure of one rule's fields does not disable the other rule.

No payment, fulfillment, archived/closed, fully-refunded-status or test-order exclusion is added: those fields are not selected. Cancellation is the known order lifecycle exclusion. A refund by itself is not an exclusion. No claim is made about a cancellation occurring after the evaluated snapshot; evidence is explicitly as-of that snapshot.

## Rule card: high_order_value

- Rule version `1.0.0`; purpose: highlight an unusually high current order total for merchant review.
- Source: `Order.currentTotalPriceSet.shopMoney.amount` and `.currencyCode`, normalized as `total.value`. Use shopMoney, not presentmentMoney, original total, subtotal, outstanding balance or collected payments.
- Shopify defines this as the current total after returns, including taxes and discounts. Consume the authoritative field after edits/returns/refunds; do not reconstruct components, apply discounts twice, subtract totalRefundedSet, or promise that every arbitrary monetary refund decreases it. This is not a net-payment calculation. Changed returned amounts can change the next result without altering a prior merchant decision.
- Settings: enabled, non-negative decimal-string threshold, explicit valid Shopify currency code and settingsVersion. Threshold and measured amount must have the same currency. Valid other currency -> `unknown / CURRENCY_MISMATCH`; unrecognized/unsupported source currency -> `unknown / CURRENCY_UNSUPPORTED`. No conversion or fallback. Missing currency/amount -> `unknown / AMOUNT_UNAVAILABLE`; malformed amount -> `unknown / INVALID_DATA`.
- Decimal grammar `^(0|[1-9][0-9]*)(\.[0-9]+)?$`; no signs, exponent, NaN, Infinity, commas or binary-number inputs. Compare exact decimal values by arbitrary-precision decimal or scaled integers with aligned scales; never Number/parseFloat and never rounding before comparison. Equivalent scales are equal.
- Applicable valid data: amount > threshold -> `matched / ABOVE_THRESHOLD`; otherwise `not_matched / AT_OR_BELOW_THRESHOLD`.
- Evidence for numeric outcomes: exact measured amount, threshold, currency and source field. For unknown/inapplicable: only safe field/gate metadata needed for the reason; no fabricated amount or copied malformed input.
- CAD100.00:99.99 and100.00 do not match;100.01 matches. Unavailable amount is unknown, not zero.

## Rule card: high_line_quantity

- Rule version `1.0.0`; purpose: highlight unusually high quantity on an individual line.
- Source: every `Order.lineItems.nodes.id` and `LineItem.currentQuantity`, normalized as `lines.value`, across every page. No SKU/title aggregation and no sum of lines.
- currentQuantity excludes refunded and removed units. Do not subtract refunds again. A transition6->4 after removal/refund can change matched to not_matched. Partial/full fulfillment alone does not reduce this value; do not substitute unfulfilledQuantity. Zero is a valid remaining quantity; a removed/absent line is not recreated from prior evidence.
- Settings: enabled and a positive safe integer threshold plus immutable settingsVersion. Each quantity must be a non-negative integer, with unique valid line IDs. No quantity, invalid negative/fractional value or duplicate ID -> unknown (unavailable uses LINES_UNAVAILABLE; invalid uses INVALID_DATA).
- Complete valid lines: any individual currentQuantity > threshold -> `matched / ABOVE_THRESHOLD`; otherwise `not_matched / AT_OR_BELOW_THRESHOLD`. Complete empty list -> `not_matched / EMPTY_LINES`. Even an apparent match on page1 remains `unknown / LINES_UNAVAILABLE` if another page is missing, preserving the approved completeness policy.
- Evidence: threshold and all matching line IDs/quantities sorted by ID for matched; threshold and maximum quantity for non-empty not_matched; threshold and lineCount0 for EMPTY_LINES. Do not add product names or SKU.
- Threshold5:4/5 do not match;6 matches; two lines3+3 do not match. Known cancelled order is not_applicable before quantity comparison.

## Shared output

Each result has `ruleKey`, `ruleVersion`, `settingsVersion` (valid string or null when absent/unavailable/invalid), `outcome`, `reasonCode`, `evidence`, `evaluatedAt`, `sourceUpdatedAt` (nullable if unavailable), and `sourceSnapshotVersion`. Trusted tenant/order/generation accompany persistence context and cannot be overridden by this object. Outcomes are exactly `matched | not_matched | not_applicable | unknown`.

Evidence is a discriminated object: `kind: value | lines | applicability | unavailable | configuration`, with only the fields specified above. Unknown results carry a field/reason, not raw upstream messages. Rule and settings versions identify the actual inputs used, never the newest saved configuration by assumption. Settings are shop-specific; changing them takes effect on the next successful processing, with no retroactive bulk reevaluation in this milestone.

Result/evidence is order-derived protected data: same tenant, createdAt+30days retention, earlier verified deletion and access boundaries as its snapshot. P09 complete privacy processing is still outstanding. A contract does not establish those future controls as implemented.

## Fixtures and checks

[Machine-readable examples](fixtures/rules-v1.json) contain full synthetic inputs and literal expected results. Each case is an isolated world; identical version labels across cases do not imply a shared mutable version record. The explicit refund pair uses different source versions. They are specifications, **not executed evaluator results**. `node scripts/check-rule-fixtures.mjs` validates artifact structure, result keys/outcomes, version/provenance presence, two-rule scope and core fixture coverage; it does not implement or test a rule evaluator. Rule execution acceptance tests belong to P06A/P06B.

P04 limitations remain: actual update/cancel webhook deliveries and live multi-page sync NOT RUN; observed equal-time stability is not an atomic Shopify snapshot. Existing two-store live order-created ingestion and bounded real API sync evidence are preserved, not repeated.

## Sources and access — verified 2026-09-29

[Order](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order), currentTotalPriceSet and originalTotalPriceSet definitions; [LineItem](https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItem), currentQuantity; [MoneyBag](https://shopify.dev/docs/api/admin-graphql/latest/objects/MoneyBag), shopMoney basis. Version-specific2026-07 URLs redirected to latest, whose selector displayed2026-07. Runtime remains pinned2026-07.

Existing `read_orders` and protected order-data access cover these selected fields; no read_all_orders, fulfillment/customer scopes or Name/Email/Phone/Address requests are added. Shopify's default history window is60days; project coverage remains the narrower current-installation/30day policy. Development access/live reads do not establish production approval.

Currency recognition uses the pinned2026-07 [CurrencyCode enum](https://shopify.dev/docs/api/admin-graphql/latest/enums/CurrencyCode), not an invented CAD-only list. A well-formed but absent enum code is unsupported; a configured invalid currency is INVALID_CONFIGURATION. No runtime enum fetch or new API query is implemented here.

Integration limit: P04 normalization currently accepts three-letter currency codes. Enum membership alone does not prove a field is available to the rule: for example a four-letter code is currently normalized as unavailable. Preserve that unknown result; this documentation does not expand normalization support. The enum's no-currency placeholder is not a merchant currency for numeric comparison. No silent conversion is allowed in either case.


P06A reconciliation: only high_order_value is now implemented, preserving P05 semantics. Earlier no-rule statements describe prior milestones. See [implementation/evidence](P06A-HIGH-ORDER-VALUE.md); merchant settings/evaluation persistence remains absent, results are internal/transient. Next P06B; P04 live limitations remain.
