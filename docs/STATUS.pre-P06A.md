# Current status — P05

Version **0.3.0**, branch `codex/p05-rule-contract`. P05 is complete as **contract and fixture specification only**. No rule evaluator, settings persistence, alerts or UI implemented.

## Changed
Exactly two cards, shared four-outcome contract, applicability precedence, exact decimal/per-line semantics, evidence and source/rule/settings versions. Earlier outcome spellings are explicitly reconciled. Fields/scopes/retention unchanged. See [contract](P05-RULE-CONTRACT.md).

## Verified
`node scripts/check-rule-fixtures.mjs`: PASS, 48 synthetic expected records and one authorization boundary record. This validates artifacts, not evaluation behavior. Targeted ESLint PASS. Independent semantic review findings about invalid settings versions and isolated fixtures were reconciled. Current official Shopify sources and verification date recorded in the contract.

## Not run / blockers
Rule execution tests and live rule behavior: NOT RUN / NOT IMPLEMENTED by scope. P04 genuine update/cancel delivery and live multi-page sync remain NOT RUN; earlier two-store ingestion and small real API sync evidence are preserved. Installation checks, app build and database migrations were not repeated for this documentation-only milestone. Production data approval, full privacy processing and hosting gates remain open. No product-decision blocker for these two preserved contracts.

## Next step
P06A, only after explicit start: implement high_order_value from the contract and turn the value examples into executable acceptance tests. No quantity evaluation, alerts or UI in that slice. Source version is not a production deployment.
