# Development runtime recovery — 2026-09-30

Operational checkpoint on the unchanged v0.8.6 application source, branch `codex/dev-runtime-recovery`. This supersedes the offline prerequisites in [the earlier preflight](DEV-RUNTIME-READINESS.md); it does not close P08 acceptance.

## Journal provenance and authorization

The owner authorized first-time provisioning only if the existing development environment had never been provisioned. P09 evidence and pre-P10A/pre-P10B status explicitly recorded that the existing dev database was untouched and its journal unprovisioned. P09/P10B test runners, their recorded executions and isolated restore procedure used fresh synthetic databases and unique keys/journals. A bounded project search found only test journals. Selected/inherited configuration and registered user/machine environment had no dev privacy key. The database still had the four pre-P09 migrations. Together these establish first-time setup for this recorded environment, not exhaustive discovery of unrelated external files.

A new stable privacy key and empty journal were provisioned outside the repository and database backup paths, using create-only operations. Directory inheritance is disabled; access is limited to the current OS user and SYSTEM. Existing session key, database connection configuration and credentials were preserved. Never regenerate or replace this journal/key on a restart or restore. Independent production custody and rollback protection remain unresolved.

## Preservation and migration

The existing PostgreSQL data directory was started, without initialization or reset. Four migration checksums matched source. Existing session encryption authenticated all four stored credential fields. The only pending privacy receipt was the known empty synthetic P02 data request; no unattributed receipts or pending redactions existed.

Before migration, a new encrypted logical backup was created and its authenticated decrypt roundtrip checked. This is **not a database restore test**. The additive P09 migration was applied. Immediate post-migration comparison preserved all original rows and columns across 13 existing non-migration tables by counts and hashes; `PrivacyDeletion` was added. Session metadata cleanup affected zero rows. Expired order/job records were zero before worker startup. Later normal worker writes are separate from this preservation checkpoint.

## Executed commands and results

Private operator helpers are intentionally not included in the public source export. They load existing configuration without printing values and use the already selected dev environment.

| Actual command | Observed result |
|---|---|
| `node .local/dev-runtime-start-db.mjs` | Existing database started; saved configuration/data-directory fingerprints unchanged |
| `node .local/dev-runtime-recovery-inventory.mjs` | Read-only migration, encryption and receipt-provenance inspection passed |
| `node .local/dev-runtime-migration.mjs before` | Encrypted logical backup and pre-migration fingerprints created |
| `node --env-file=.env.local node_modules/prisma/build/index.js migrate deploy` | Exactly the pending P09 migration applied; no reset |
| `node .local/dev-runtime-migration.mjs after` | 13 existing tables preserved; new privacy table present |
| `node .local/dev-runtime-service.mjs dev` | Existing linked dev preview reached Ready; no login required |
| `node .local/dev-runtime-health.mjs` | `/healthz` and `/readyz` returned 200 over loopback and HTTPS |
| `node .local/dev-runtime-service.mjs privacy` | Worker running; one known empty synthetic request completed; no retry/unavailable indication |
| `node .local/dev-runtime-service.mjs orders` | Worker running; two ordinary jobs completed at observation; no retry/unavailable indication |

The private health result reports `shopify: configured_not_verified`. It is not embedded authentication or browser workflow evidence. Detailed hashes, process records and sanitized health results remain in ignored local evidence. No raw payloads, secrets, machine paths or live identifiers are published.

## Startup corrections

Installed Shopify CLI 3.94.3 initially discovered archived rehearsal web configurations as extra backends. The preserved ignored linked config now restricts `web_directories` to a dedicated local web launcher which executes the unchanged app from the repository root. Archives and application source were not edited.

An initial primary preview invocation with `--no-update` retained the placeholder application URL and failed webhook URI validation. Removing that flag let normal CLI development URL synchronization run; the preview then reached Ready. That flag belongs only to an explicitly configured secondary preview sharing an existing server. Current restoration covers the selected second development store; the other store's preview has not been refreshed in this recovery.

Official documentation checked 2026-09-30: [app structure and web discovery](https://shopify.dev/docs/apps/build/cli-for-apps/app-structure), [app configuration and development application](https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration). Installed `app dev --help` also checked. No CLI upgrade, production deploy, scope/distribution/PCD/questionnaire change or installation repeat occurred.

## Decision and remaining checks

**Runtime ready for an owner-operated P08 check; release not ready.** PostgreSQL, dev preview and both workers remain running. Start with opening the existing app and identifying the correct shop/interface; then proceed one step at a time with explicit synthetic test settings, never invented defaults.

Current embedded workflow, Console/hydration, screenshots, order link and direct foreign-ID rejection remain NOT RUN. The saved browser permission blocker was not bypassed or retried here. Actual privacy subscription/delivery, production access, identity/support, provider security/backup/export delivery/journal custody, dependency advisory and remaining P04/P08–P10 gates remain open. Full tests/build were not repeated for operational recovery; the 240-test result remains scoped to v0.8.5. No deletion or restore test used the existing development database.
