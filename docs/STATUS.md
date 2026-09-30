# Current status — P07

Version **0.6.0**, branch `codex/p07-exception-lifecycle`. Local backend slice complete; no UI or live activation.

## Changed
Persisted explicit shop rule settings with validation/version guards and no default thresholds; both rule results saved atomically with the winning order snapshot. Stable exception identity per shop/order/rule, open/acknowledged/resolved/ignored states, encrypted revision-ordered history. Terminal decisions never reopen automatically; current outcome/freshness is separate. Authenticated read/action APIs with tenant, installation, expiry and pending-privacy boundaries. Additive migration and uninstall settings cleanup.

## Verified
`npm test`183/183 PASS, including21 new lifecycle/HTTP cases, two-process PostgreSQL action race, duplicate/crash replay, stale/settings races, preserved Ignore, unknown and foreign-ID protection. `npm run db:generate`, typecheck, lint and build PASS. Detailed transition table written before behavior changes, exact commands, synthetic before/after records, API and limitations: [P07-LIFECYCLE.md](P07-LIFECYCLE.md).

## Not run / blockers
Dev/live DB migration, real-store configured actions and UI verification NOT RUN. No real merchant thresholds saved. HTTP auth evidence uses real SDK + synthetic signed tokens/mock network, not live Shopify. P04 real update/cancel deliveries and live multi-page sync remain NOT RUN; install cycles not repeated. Full privacy processing/restore, production approval and hosting remain open. List/history endpoints currently unpaginated; bound them with P08 before scaling.

## Next
P08 settings/inbox/detail/evidence UI on the existing authenticated APIs, only after explicit start. Add bounded pagination and verify unknown/stale/terminal decision presentation. A selected dev runtime needs the additive migration and explicit merchant settings before live use. Source publication is not deployment.
