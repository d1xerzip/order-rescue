# Rule contract

Proposed behavior; the rule engine is not implemented.

## Shared semantics
Input: authenticated `shop_id`, eligible order identity, source revision/time, explicit field availability, complete normalized snapshot, versioned shop rule configuration. Never accept tenant identity from a browser parameter alone.

Exactly four evaluation outcomes: `match`, `no_match`, `not_applicable`, `unknown`. Disabled rule or a known cancelled/out-of-coverage order → `not_applicable`. Missing/redacted/invalid required data, access errors or incomplete pagination → `unknown` with reason; never coerce to zero. A successful complete empty line list → `no_match`. Rule outcomes are independent: an unavailable total need not block a valid quantity check. Eligibility must itself be known; unknown cancellation/created time cannot silently pass.

Store `rule_key`, `config_version`, `outcome`, `reason_code`, `evaluated_at`, source timestamp, and only necessary evidence. No raw payload or free-text customer information. Exact decimal arithmetic; never compare money as binary floating point.

| Rule | Measured value | Configuration | Match |
|---|---|---|---|
| `high_order_value` | `Order.currentTotalPriceSet.shopMoney.amount` and `.currencyCode` | enabled; non-negative decimal threshold; explicit matching currency | amount strictly greater than threshold |
| `high_line_quantity` | Each `LineItem.currentQuantity`, individually, across all pages | enabled; positive integer threshold | any single line strictly greater than threshold |

Value is the current order total, not original total, outstanding balance or converted presentment value. Quantity excludes refunded/removed units per the cited field definition; do not sum different lines or group by SKU. Field definitions were checked in the reference displaying 2026-07; verify pinned schema and live access before implementation. Refunds/edits performed outside our app may change the observed snapshot; our app never performs them.

A currency mismatch produces `unknown/CURRENCY_MISMATCH`; ask merchant to reconfigure, never convert silently. Negative/non-finite totals or malformed quantities produce `unknown/INVALID_DATA`. Missing configuration keeps a rule disabled; reject invalid setting writes on the server.

## Alert lifecycle proposal
One alert identity `(shop_id, order_id, rule_key)`; one quantity alert may list multiple matching line IDs. Two rules may produce two alerts for one order. Duplicate/reordered events never add duplicates.

First match → `open`. Repeated matches update current evidence; changes are timestamped. `open` → `resolved` or `ignored` only by authenticated merchant action. Terminal state stays terminal on later updates/settings changes in V1; no automatic reopening. Keep the decision's rule version and evidence separate from current evaluation, within the same retention limit. Resolve means reviewed, not order repaired; Ignore means intentionally dismissed.

If an open alert later becomes `no_match`, `not_applicable` or `unknown`, retain its review state but label current condition clearly (no longer matching / not applicable / unable to check). Historical evidence must never look like a current finding. No automatic Resolve. Orders without any match appear only in coverage/error details when needed, not as fabricated exceptions.

## Synthetic acceptance cases — specification, NOT RUN
All examples assume known eligibility and complete valid data unless stated. Thresholds below are fixtures, not defaults.

| ID | Input | Expected |
|---|---|---|
| R01 | CAD threshold 1000; amounts 999.99 / 1000.00 / 1000.01 | no_match / no_match / match |
| R02 | CAD threshold 0.10; amount 0.10 / 0.11 | no_match / match with exact decimals |
| R03 | CAD threshold; USD shopMoney | unknown/CURRENCY_MISMATCH |
| R04 | Missing amount or GraphQL access error | unknown, no false safe result |
| R05 | Quantity threshold 10; lines [10, 10] | no_match; sum 20 is irrelevant |
| R06 | Quantity threshold 10; lines [2, 11, 12] | one quantity alert with the two matching line IDs |
| R07 | First page complete but another page unavailable | unknown until all pages succeed |
| R08 | Disabled rule / known cancelled order | not_applicable |
| R09 | Refund changes currentQuantity from 11 to 9 | current no_match; prior decision preserved and labelled |
| R10 | Same event twice, concurrently, or after crash | one alert identity, no duplicate effects |
| R11 | Resolve then new matching snapshot | resolved persists; no Shopify write |
| R12 | Shop A asks to Ignore shop B's alert ID | denied; no existence/data leak or mutation |
| R13 | Settings changed; order not processed again yet | old evaluation labelled with its version; no claimed reevaluation |
| R14 | Rule matches on total but line pagination fails | value match and quantity unknown shown independently |
