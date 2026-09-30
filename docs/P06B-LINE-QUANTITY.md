# P06B — high line quantity

Version 0.5.0, 2026-09-29. Accepted P05 semantics unchanged; rule and result contract version 1.0.0. User explicitly requested this implementation. All 48 literal P05 examples now assert actual evaluator output (26 value, 22 quantity).

## Behavior and boundaries
- Exactly high_order_value and high_line_quantity. Quantity uses LineItem.currentQuantity, strictly greater than a positive safe integer threshold, per line. No sum or SKU aggregation. Threshold 5 is fixture-only.
- Refund/removal already reduces currentQuantity; no second subtraction. Fulfillment alone is not an exclusion. Known cancellation precedes numeric comparison. Shared P05 ordered applicability is extracted unchanged from P06A.
- Complete available empty lines => EMPTY_LINES, not_matched. Missing pages/data => LINES_UNAVAILABLE, unknown, even if a known line appears to match. Malformed quantities or duplicate/invalid line IDs => INVALID_DATA. Unknown is never treated as zero.
- All matching IDs/currentQuantity values are sorted by ID; no title, SKU or customer field copied. Invalid settings rejected at configuration boundary; defensive corrupt settings produce unknown. Trusted tenant mismatch throws before evidence.
- evaluateStoredOrderRules produces both results from one normalized snapshot, canonical digest and explicit evaluation time. processOneOrderJob validates settings for the claimed tenant before fetch and only returns evaluations after completion fencing succeeds. Existing evaluation property remains a compatibility alias for value.
- Settings are explicit, immutable per call and tenant-bound, not a global default for the multi-shop queue. Normal worker has no saved settings resolver and returns NOT_CONFIGURED. Results are transient internal objects, not stored exceptions or merchant UI. P07 must integrate durable settings/version resolution and result/exception persistence without a second ingestion pipeline.

## Changed files
app/rules/high-line-quantity.ts and common.ts; contracts.ts and high-order-value.ts; app/order-evaluation.server.ts and order-jobs.server.ts; tests/high-line-quantity.test.ts and order-value-integration.test.ts. README, CHANGELOG, package root versions, STATUS/NEXT with prior snapshots, RULES, P05 contract, ARCHITECTURE and ROADMAP updated. No schema/migration, transport, worker CLI or UI changes.

## Executed commands and results
- node --import tsx --test --test-reporter=dot tests/high-order-value.test.ts — 53/53 PASS after shared gate extraction.
- node --import tsx --test --test-reporter=spec tests/high-line-quantity.test.ts tests/high-order-value.test.ts — 87/87 PASS, including frozen deterministic inputs, 4/5/6, 3+3, refunds/removal/fulfillment, lifecycle, malformed/unavailable data, two shops, both/neither rules and independent unknown results.
- npm test -- tests/order-value-integration.test.ts tests/order-ingestion.test.ts tests/order-sync.test.ts tests/order-updates.test.ts tests/order-snapshot.test.ts — initially 37/40 PASS, three new integration failures. A preceding intentional lease-loss fixture left a claimable job for the next test. Added afterEach cleanup restricted to fixture shops, without changing app behavior.
- npm test -- tests/order-value-integration.test.ts — after repair 11/11 PASS on a new disposable PostgreSQL database. Includes both/neither pair, shared digest/time, distinct settings versions, unknown independence, foreign/invalid quantity settings rejected before fetch, crash replay and no evidence on lost completion lease.
- The other 29 ingestion/snapshot/sync/update cases passed in the earlier run; not repeated after test-only cleanup. Total 127 distinct passing tests across runs, not one combined command.
- npm run typecheck; npm run lint; npm run build — PASS. Existing empty resource chunks and React Router future-option warnings remain nonfatal.
- npx eslint tests/high-line-quantity.test.ts and npx eslint app/rules/common.ts app/rules/contracts.ts app/rules/high-line-quantity.ts — PASS. Independent read-only review found no contract/fencing defects; results verified by primary agent.

## Official source and limitations
On 2026-09-29 official [LineItem documentation](https://shopify.dev/docs/api/admin-graphql/latest/objects/lineitem) search result confirmed currentQuantity excludes refunded/removed units and is distinct from quantity and unfulfilledQuantity. Direct version-specific 2026-07 and latest page opens failed in the browsing tool; do not claim those direct pages verified this turn. Runtime API remains pinned 2026-07, existing P05 source evidence retained. No new API decision, field or access request made.

No real Shopify configured-rule run or owner visual acceptance this turn. No repeated install checks. P04 genuine update/cancel webhook deliveries and live multi-page synchronization remain NOT RUN; previous bounded live ingestion/sync evidence is preserved. Production/privacy gates remain open. P07 evaluator dependencies now pass for local work only; exception persistence and merchant settings are not already implemented.
