# Current status — P08 live runtime preflight blocked

Version **0.8.6**, codex/dev-runtime-readiness, 2026-09-30. Read-only inspection of v0.8.5 / c706d7eaa8c1898eb15dd33ef804c5d6d9e26976; application, tests, schema and installed dependencies unchanged.

## Changed
Recorded fresh browser denial, independent local runtime prerequisites and specific owner actions in [DEV-RUNTIME-READINESS.md](DEV-RUNTIME-READINESS.md). Preserved previous status/next snapshots. No runtime or account changes.

## Verified
Browser inventory available; Codex In-app Browser rejected both admin.shopify.com and dev.shopify.com with saved-user-permission denial. No bypass attempted. Independent read-only preflight found the selected local DB/web endpoints unavailable and no matching dev/tunnel/worker candidates. Selected env file lacks privacy key/journal path configuration; no values printed. Schema and receipt provenance could not be read from the unavailable database. Source equality, release metadata, documentation links and public sanitization checked.

## Not run / blockers
Actual P08 order/inbox/evidence/action/reload/settings/order-link/foreign-ID/embedded Console workflow, screenshots and current Shopify hydration remain NOT RUN. Health/readiness HTTP checks and current DB migration/provenance checks NOT RUN. No process startup, migration, live cleanup, journal initialization, account/questionnaire change or installation repetition. Full suite/build not repeated because runtime unchanged;240-test PASS remains v0.8.5 evidence.

The local auth race remains fixed by v0.8.5 evidence. Deepmerge advisory remains OPEN (previous4high findings). Preserve P04 remaining live checks; P09 actual privacy registration/delivery, existing-dev migration/journal/worker/provenance, production PCD, legal/support identity, secure export handoff, provider/TLS/volume/log/backups and independent journal custody gates.

## Decision / next
**Dev runtime NOT READY; release NOT READY.** Owner must correct the saved browser-site denial; chat approval alone does not alter the enforced setting. Separately prepare the dev runtime only after receipt/journal provenance review and a concrete reviewed migration/provisioning plan. See [NEXT.md](NEXT.md).
