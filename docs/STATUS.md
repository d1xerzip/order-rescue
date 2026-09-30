# Current status — manual P08 progress and form-control correction

Version **0.8.8**, codex/p08-form-identifiers, 2026-09-30, based on v0.8.7 / ac9a88e87116d6f96e6b5939068df05666d76d32. Final file hashes: SOURCE-MANIFEST.json in the sanitized release. Previous detailed working status is preserved in STATUS.pre-p08-manual.md.

## Changed
Added stable id/name attributes to rule-enable checkboxes and the Review state filter. Two markup edits only; existing handlers, labels, API requests, rule semantics, schema and dependencies are unchanged. Consolidated manual development evidence in [P08-MANUAL-ACCEPTANCE.md](P08-MANUAL-ACCEPTANCE.md).

## Verified
Actual owner-operated Shopify workflow plus read-only database assertions: both explicit rule settings/save/reload; authentic dev order ingestion and exact fields; value match and quantity-only match/value no-match; one exception per intended signal; evidence; Resolve and Ignore with audited actor/time/versions and reload; correct Open in Shopify destination. The first intended Ignore was actually Resolve as confirmed by the owner; its failed expectation remains documented, and Ignore passed on a separate fixture.

The latest All levels Console screenshot has no visible red/hydration errors or hidden-message count; bounded manual observation PASS. The form id/name Issue disappeared after the fix. Remaining warnings/performance notices and deprecated unload Issue are recorded, not suppressed or assigned unsupported provenance. Lint/typecheck/build PASS for the changed component; typecheck required a retry after sandbox filesystem denial. No full-suite repeat; 240-test PASS retains v0.8.5 scope. Original screenshots/private helper data are not published.

## Not run / blockers
Current live narrow viewport/keyboard, failure/conflict, foreign-ID HTTP and broader unknown/partial-sync/pagination/changed-evidence scenarios remain NOT RUN in this sequence. Prior local/P02 evidence retains its scope. Browser automation still denied; all new visual evidence is owner-operated, with no bypass. No repeated install, account/scopes/questionnaire change, data reset, live deletion/restore test or deployment.

Existing dev migration/journal/worker preparation was completed by v0.8.7; see [recovery](DEV-RUNTIME-RECOVERY.md). Remaining P04 live lifecycle/sync, P09 actual registration/delivery, production PCD, legal/support, secure export delivery, provider/TLS/storage/log/backups and independent journal custody gates remain open. The separate deepmerge advisory is OPEN; auth-race correction retains v0.8.5 evidence.

## Decision / next
**P08 partially verified; release NOT READY.** Next single manual check: narrow viewport layout and access to the inbox/evidence/settings without writing records. Keep successful settings/order/action/link steps closed. See [NEXT.md](NEXT.md).
