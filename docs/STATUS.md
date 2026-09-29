# Current status — P06A

Version **0.4.0**, branch `codex/p06a-high-order-value`. Only the accepted high_order_value rule is implemented; rule/contract version1.0.0.

## Changed
Pure exact-decimal evaluation with explicit state, configuration validation, four outcomes and versioned evidence. Connected to the existing fenced order-job path; evaluates the stored winning snapshot, returns evidence only after successful completion. No second pipeline, schema migration, extra Shopify fields/scopes, quantity evaluator or exceptions UI.

## Verified
53 pure tests (all26 accepted P05 value examples plus defensive/precision/lifecycle cases);8 disposable PostgreSQL integration tests;20 affected ingestion/sync/update regression tests.81 distinct tests across targeted runs, not one combined81-test command. Typecheck, lint and build PASS. Details, changed files, exact commands and initial type-inference repair: [P06A-HIGH-ORDER-VALUE.md](P06A-HIGH-ORDER-VALUE.md).

## Not run / blockers
Live configured rule execution: NOT RUN. There is no persisted merchant settings/evaluation model or settings UI yet: explicit tenant-bound settings are accepted internally, results are transient, normal worker settings remain null/NOT_CONFIGURED. No merchant default threshold installed. P04 actual update/cancel deliveries and live multi-page sync remain NOT RUN; prior small two-store live sync/ingestion evidence preserved. P02 install cycles not repeated. Production approval/privacy/hosting gates remain open.

## Next
P06B quantity-rule implementation only after explicit start; preserve the accepted per-line semantics and shared result contract. Source publication is not deployment.
