# Current status — P08

Version **0.7.0**, branch `codex/p08-merchant-workflow`. Local implementation and synthetic browser checks complete; real Shopify P08 acceptance remains NOT RUN.

## Changed
Embedded merchant workspace: onboarding, explicit persisted settings without defaults, inbox/filter/pagination, detail/current and decision evidence, history, Open in Shopify, server-confirmed Resolve/Ignore/Acknowledge. Unknown/empty/partial-sync/stale/error states remain distinct. Existing dev database received the additive P07 migration without reset; encrypted pre-migration backup and unchanged old-row hashes/counts verified. No real merchant thresholds written.

## Verified
`npm test`189/189 PASS; focused pagination/HTTP/lifecycle27/27 PASS; typecheck, lint, build and harness syntax PASS. Actual production build + disposable PostgreSQL + synthetic Shopify authentication/transport exercised in Opera: configure→order→inbox→evidence→decision→reload, two-tab decision/settings conflicts, unknown data, partial sync, pagination, foreign404, HTTP503, total server outage, keyboard and narrow iframe. No application JavaScript/hydration errors in final Opera checks. Sanitized screenshots and exact commands: [P08-MERCHANT-WORKFLOW.md](P08-MERCHANT-WORKFLOW.md).

## Not run / blockers
Shopify Admin browser permission remains denied: actual embedded P08 journey, live App Bridge requests and real Open in Shopify navigation NOT RUN. The in-app browser still produced hydration errors on the local build while Opera did not; its clean-console acceptance remains pending. No install tests repeated. P04 real update/cancel deliveries and live multi-page sync remain NOT RUN. P09 full privacy processing/restore, production PCD approval and hosting remain open. Source publication is not deployment.

## Next
P09 privacy processing on the full stored inventory, including settings/evaluations/exceptions/history, with synthetic export/redaction/replay/restore tests. Keep P04/P08 live gates for P10. No new rules or features.
