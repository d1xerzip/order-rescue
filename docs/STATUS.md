# Current status — auth refresh fence verified locally / release blocked

Version **0.8.5**, codex/auth-refresh-fence, 2026-09-30. Baseline public v0.8.4 at e2ee3592b5299f644ebb84d8c220ef3171ac3ff9. Runtime repair; no schema, dependency version, product/rule or Shopify-account change.

## Changed
OAuth deadline10s includes response-body consumption and existing abort signals. Official encrypted session mapping now uses the transaction owning the auth lock; stale callbacks cannot save credentials or activate a shop after transaction loss/uninstall/reinstall. Activation and session commit atomically. [Implementation, commands and limits](AUTH-REFRESH-FIX.md).

## Verified
Actual loopback SDK reproducer PASS:10030ms cancellation, socket closed, no late credential row after uninstall, ordinary access denied, privacy intake200. Historical0.8.4 FAIL remains preserved. Full synthetic PostgreSQL suite **240/240 PASS**, including header/body stalls plus successful retry, four concurrent refreshes, signed uninstall/reinstall, deliberately terminated auth backend with exact new Shop/Session preservation, foreign-domain rejection and privacy races. Typecheck/lint/build PASS; final fixture tsc/lint PASS. [Bound evidence](evidence/auth-timeout/regressions.json).

## Not run / blockers
No fresh live Shopify/browser/token revocation, load/backup/restore or dependency audit. Earlier load/restore results retain their dates; source publication is not deployment. deepmerge advisory remains OPEN with previous4high findings; this separate runtime fix does not remediate it.

Keep P08 actual Admin/App Bridge/workflow/order link/embedded Console and P04 actual update/cancel/multipage checks open. Keep P09 existing-dev migration/journal/worker/provenance, actual privacy registration/delivery, production PCD, legal/support identity, secure export handoff, provider/TLS/volume/log/backups and independent journal custody gates open. No existing dev database, journal, account/questionnaire, process or live record was changed.

## Decision / next
**Local auth race closed by regression evidence; NOT READY for pilot, production or App Store submission.** Next: close the smallest available external acceptance gate without treating local results as Shopify E2E; supported dependency remediation remains separately required. See [NEXT.md](NEXT.md).
