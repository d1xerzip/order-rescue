# Current status — P10A local QA / open live gate

Version **0.8.1**, codex/p10a-functional-qa, 2026-09-30. Baseline public v0.8.0 at dbc08262e12156898221bb19aad919aca6050710. Patch fixes/local QA complete; full P10A acceptance remains open. Final source state is bound by the sanitized release commit/tag and SOURCE-MANIFEST.json.

## Changed
React/runtime/types19.3.0 repair the reproduced local IAB hydration failure using the normal entry; two-tab Load latest also refreshes the inbox row. Add13 predetermined acceptance cases through persisted settings/normal worker/HTTP evidence and sync authentication coverage. Reconcile current documentation while preserving older milestone reports. Rules, inventory, retention and monitoring boundaries unchanged.

## Verified
npm test -- tests/qa-functional.test.ts **17/17 PASS**; final npm test **231/231 PASS**. Prisma generation/typecheck/lint/build PASS. Fresh separate synthetic PostgreSQL database; deletion/restore never touched existing dev data. Actual local browser order→evidence→Resolve/Ignore→reload, stale two-tab409 recovery,503 recovery, settings keyboard save/reload, unknown/partial sync and foreign404/unchanged checks pass. Local direct IAB Console/hydration is clean after repair. [Exact matrix/commands/environment/screenshots](QA-FUNCTIONAL.md).

## Not run / blockers
P08 actual Shopify Admin/App Bridge/workflow/order navigation and embedded Console remain **NOT RUN**. Owner's Always allow settings did not unblock either domain: IAB still returns a saved-permission security refusal. No alternate-browser workaround. Earlier install cycle was not repeated. P04 actual update/cancel and multi-page cases remain NOT RUN.

P09 existing-dev migration, privacy journal and worker remain unrun; review legacy pending synthetic receipts before any processing. Actual compliance subscriptions/delivery NOT RUN. Production PCD, legal/support identity, secure export handoff, provider/TLS/volume/log/backup controls and current independent journal custody remain unresolved. Prepared exports are not delivered compliance. No live deletion/restore or account/questionnaire change.

npm audit --omit=dev --json exit1:5 entries (4high/1low), two advisories; bounded reachability analysis recorded, compatible dependency fixes still required. No claim of production/App Store readiness. Source publication is not deployment.

## Next
**P10B can start independent local reliability/dependency checks; the full P10A release gate is not passed.** Use [NEXT.md](NEXT.md). Preserve all live/privacy blockers; after browser access works, verify the real workflow and registration without repeating passed install checks.
