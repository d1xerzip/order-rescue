# P08 acceptance reconciliation — 0.8.9

2026-09-30. Documentation/evidence checkpoint based on v0.8.8 / df97e29d32ea0f68bbc42f796c2664cd48bc114d. No application, dependency, schema or account change. Final source hashes are recorded in SOURCE-MANIFEST.json. This report supersedes blanket current P08 gap statements in older reports, without rewriting their historical results.

## Criterion and environment

PASS is bounded to its evidence. A carried-forward result is not a new test run; synthetic authentication is not actual App Bridge proof.

| Criterion | Result and evidence | Actual Shopify remainder |
|---|---|---|
| Settings, both rules, exact selected order fields, inbox/evidence | PASS owner-operated dev workflow plus read-only DB assertions; P08-MANUAL-ACCEPTANCE.md | Only the observed fixtures/settings, not every rule boundary |
| Resolve and Ignore persistence, audit, order link | PASS owner reload/screenshots plus DB readback; first mistaken Resolve retains its historical failed Ignore expectation | No repeat or terminal-decision reset needed |
| Embedded hydration/current Console | PASS bounded owner All levels observation; form Issue gone after v0.8.8 | Other warnings remain; not a universal browser clearance |
| Narrow evidence/history at390px | PASS owner-confirmed width and screenshot readability | Live DOM overflow not measured |
| Narrow evidence/settings layout and keyboard | PASS current v0.8.8 synthetic production-build browser;390px iframe,375px document/client/scroll widths;0 outlying tested controls; Enter/Tab navigation;0 captured errors/warnings | Actual Shopify keyboard path NOT RUN; one non-writing owner step requested |
| Failure/no false success, settings/action conflicts | PASS retained synthetic browser reports from P08/P10A; unchanged relevant source | Current Shopify fault/conflict NOT RUN; deliberate outages remain isolated-only |
| Direct foreign-ID reads/actions/cursors | PASS retained real PostgreSQL and SDK authentication with synthetic signed requests; GET/POST404, empty response, target unchanged; browser harness probe also reported404/404 | Current real App Bridge exception-ID probe NOT RUN; security evidence gap stays open. P02 workspace-record isolation does not substitute |
| Unknown/stale/partial-sync, pagination, changed terminal evidence | PASS retained integration assertions and bounded historical browser evidence | Broader current Shopify variants NOT RUN |
| Cancellation/update/multi-page reconciliation | PASS synthetic P04/P10A cases | Existing actual P04 gate remains open |

## Reconciliation and verification performed

- Inspected actual tests/exception-http.test.ts foreign direct-ID assertions and tests/exception-lifecycle.test.ts concurrency, unknown, failed/stale and terminal-decision assertions. tests/qa-functional.test.ts compares full normalized snapshots and direct foreign-request target before/after, not merely counts.
- Re-read the private v0.8.5 full-suite log:240 tests,240 pass,0 failed/skipped/cancelled. This is historical execution evidence, not a run on0.8.9. Historical UI reports/screenshots document503/409/unknown/pagination behavior; a harness startup log alone does not establish those interactions.
- Compared v0.8.5 to v0.8.8: only two form identifier markup edits plus package version metadata in app/tests/scripts/schema/package paths. Compared the current published runtime/test sources to the working source with portable migration-name mapping. No behavior change requires repeating those successful checks.
- Independent read-only reviewer examined source/test gaps; findings were checked against actual assertions, the saved suite log and source comparison. Local failures/conflicts remain evidence in their permitted environment; no synthetic PASS is relabeled Shopify E2E.
- Re-read private responsive result.json: evidence and settings widths375/375 in a390px iframe; controls within bounds; five inputs identified; keyboard reached order link/actions and settings controls without writes. Initial335px frame was corrected before measurement. Browser override reset and temporary tab closed.
- A fresh Shopify Admin access attempt still failed in Codex In-app Browser: "Browser Use rejected this action due to browser security policy. Reason: A saved user permission setting blocks this action. Browser use cannot access https://admin.shopify.com because the user has a saved preference that blocks it." No bypass attempted.

Commands/readback used: git diff v0.8.5 v0.8.8 --stat -- app tests scripts prisma package.json package-lock.json; Get-Content .local/auth-fix-suite.log -Tail 12; Get-Content .local/p08-narrow/result.json; targeted source reads; node .local/p08-reconcile-prepare.mjs (source comparison, content scan and local Markdown links); node .local/p08-reconcile-stage.mjs (allowlisted staged hashes and git diff --cached --check). Private helper/log paths identify execution provenance, are excluded from publication, and are not portable test commands. Reproduction entry points remain npm test and node scripts/ui-test-server.mjs in isolated synthetic databases, as documented in LOCAL-SETUP.md. They were not rerun for this documentation-only checkpoint. Existing v0.8.8 lint/typecheck/build evidence remains unchanged.

## Decision

The principal P08 merchant workflow has bounded actual manual development evidence, complemented by independent synthetic negative-path tests. Keep successful steps closed. Full P08/P10A acceptance is still OPEN for remaining explicitly unexecuted platform checks; this report does not relax the current real exception-ID isolation gate. Do not inject a live outage to fill a matrix cell. Proposed additional live observations must add evidence beyond existing authorized local tests.

Remaining release blockers: P04 actual lifecycle/synchronization cases; P09 actual privacy registration/delivery; production PCD; owner/legal/support details; secure export delivery; provider/TLS/storage/log/backups and independent journal custody; supported Prisma/deepmerge advisory remediation. Dev journal/migration/worker recovery was completed earlier and is not a missing prerequisite now. The separate auth race retains its fixed v0.8.5 result; it does not close the advisory. No deployment, review submission, account change or new installation occurred. Release NOT READY; local P10B work already has its own bounded envelope, not full operational approval.

Next: complete the actual embedded non-writing keyboard observation, then scope an owner-operated authenticated foreign-exception-ID probe if browser policy remains blocked. Do not ask for passwords or copied session tokens. Keep other stage gates separate.
