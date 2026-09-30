# Order Rescue

A read-only Shopify embedded app for reviewing order exceptions. Version **0.8.8**.

React Router, TypeScript, PostgreSQL and Prisma. Exactly two accepted rules use exact current order value and per-line current quantity. Explicit settings without default thresholds, inbox, evidence/history and Open in Shopify. Resolve/Ignore change app alerts only and remain closed under reevaluation. No AI, customer messaging or Shopify order mutations.

Server authentication, encrypted minimal snapshots, durable ingestion, bounded synchronization, tenant-isolated decisions and privacy processing are implemented. **The current runtime suite (v0.8.5) passed240 tests**, including a predetermined persisted-setting/normal-pipeline release dataset. The local in-app browser hydration defect and stale inbox row after two-tab conflict recovery are repaired. Synthetic browser actions/settings/failure/unknown checks pass. [Functional evidence](docs/QA-FUNCTIONAL.md) separates local tests from current Shopify E2E.

Remaining P08 live cases, P04 remaining live cases and P09 actual privacy registration/delivery stay open. Production access, identity/contact, hosting/encryption/backups, secure export delivery and journal custody are unresolved; the Prisma/deepmerge production advisory still requires supported remediation. **Not production or App Store ready.** Full P10A/P10B gates remain open. The independent local P10B envelope passes:180 synthetic orders plus36 duplicates, recovery and actual isolated backup/restore; this is not real merchant capacity. See [reliability evidence](docs/QA-RELIABILITY.md). Source publication does not deploy or change Shopify settings.

The0.8.3 update records a [dependency remediation proposal](docs/DEPENDENCY-REMEDIATION.md), not an implemented fix: current upstream peers/pins prevent a supported drop-in update. That investigation did not change runtime/dependencies; the advisory remains open.

The0.8.4 [actual auth-timeout diagnostic](docs/AUTH-TIMEOUT-DIAGNOSTIC.md) found a separate release blocker: an uncancelled refresh can write encrypted credentials after auth-lock expiry and uninstall. Its historical acceptance is FAIL; ordinary access remained denied. The0.8.5 [runtime correction](docs/AUTH-REFRESH-FIX.md) now cancels OAuth through response-body read and atomically fences credential/activation writes. The actual reproducer and race regressions pass. This does not remediate the dependency advisory.

The0.8.6 [historical preflight](docs/DEV-RUNTIME-READINESS.md) found browser and runtime blockers. The current [runtime recovery](docs/DEV-RUNTIME-RECOVERY.md) restores the development database/preview/workers and provisions the first independent dev journal after provenance review. Owner-operated P08 is in progress; browser automation and release acceptance remain blocked. That recovery preserved application source and dependencies.

The0.8.8 [manual development checkpoint](docs/P08-MANUAL-ACCEPTANCE.md) verifies both rules, explicit settings, audited Resolve/Ignore with reload and correct Shopify order navigation. Stable form identifiers remove the observed form-control Issue; the latest owner Console screenshot shows no red/hydration errors. Other warnings and remaining UI/isolation/privacy/security gates stay open.

- [Status](docs/STATUS.md), [next task](docs/NEXT.md), [changelog](CHANGELOG.md)
- [Local setup](docs/LOCAL-SETUP.md), [merchant workflow](docs/P08-MERCHANT-WORKFLOW.md)
- [Rules](docs/RULES.md), [lifecycle](docs/P07-LIFECYCLE.md), [architecture/inventory](docs/ARCHITECTURE.md)
- [Privacy evidence](docs/PRIVACY-EVIDENCE.md), [policy draft](docs/PRIVACY-POLICY.md), [support](docs/PRIVACY-SUPPORT.md)
- [Ingestion](docs/P03-INGESTION.md), [sync](docs/P04-SYNC.md), [roadmap](docs/ROADMAP.md)

Synthetic checks: npm ci, npm run db:generate, npm test. Browser harness: npm run build, then node scripts/ui-test-server.mjs; open http://127.0.0.1:3108/__test. It uses a fresh disposable database, fake transport and real SDK authentication, not a live Shopify session. Never reset an existing database or invent merchant thresholds. P09 requires PRIVACY_LEDGER_KEY/PRIVACY_JOURNAL_PATH and a separate worker; read setup/provenance constraints before applying to existing data.

This portable source excludes linked account configuration, credentials, databases, machine identities and private operational history. See [publication boundaries](docs/PUBLIC-REVIEW.md).
