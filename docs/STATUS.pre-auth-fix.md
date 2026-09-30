# Current status — actual auth-timeout diagnostic / release blocked

Version **0.8.4**, codex/auth-timeout-diagnostic, 2026-09-30. Baseline public v0.8.3 at 3fc699d481ac63c5450e33537097bd4cea73e021. Diagnostic/evidence patch only; application, schema, installed dependencies and rule semantics unchanged.

## Changed
Added reproducible actual loopback HTTP + official SDK refresh experiment in a new isolated synthetic PostgreSQL database. Explicitly separated this P10B reliability check from the deepmerge advisory. [Report, proposed correction and limits](AUTH-TIMEOUT-DIAGNOSTIC.md).

## Verified
**Operational acceptance FAIL, diagnostic completed.** Refresh remains pending/socket open at65s, with no SDK abort signal. After lock expiry authentic synthetic uninstall removes sessions in16ms; late response recreates an encrypted session, then outer auth fails P2028. Ordinary access remains blocked, privacy intake200 and other-shop recovery pass. Normal delayed refresh292ms. Final typecheck/lint PASS; run-source hashes verified.

## Not run / blockers
No runtime fix, advisory remediation, fresh full-suite/build/load/restore or actual Shopify check performed. Previous233 tests/P10B synthetic envelope PASS remain prior results; they did not cover this new late-refresh race. deepmerge advisory remains OPEN with previous4high audit findings; diagnostic success does not remediate it.

New blocker: uncancelled OAuth refresh and stale credential persistence after expired auth lock/uninstall. Body-stall cancellation, reinstall-generation and privacy-erasure variants still require tests. Do not approve unattended merchant workers/rollout while this defect is open; no existing process stopped or real session deleted.

Keep P08 actual Admin/App Bridge/workflow/order link/embedded Console and P04 actual update/cancel/multipage checks NOT RUN. Keep P09 existing-dev migration/journal/worker/provenance, actual privacy registration/delivery, production PCD, legal/support identity, secure export handoff, provider/TLS/volume/log/backups and independent journal custody gates open. Browser denial not bypassed; no account/questionnaire/deployment/live deletion action.

## Decision / next
**NOT READY for pilot, production or App Store submission.** Next: bounded OAuth transport cancellation and atomic stale-session write rejection, preserving the official auth flow; see [NEXT.md](NEXT.md). This separate fix will not close the dependency advisory.
