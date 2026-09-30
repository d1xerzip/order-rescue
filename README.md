# Order Rescue

A read-only Shopify embedded app for reviewing order exceptions. Version **0.8.2**.

React Router, TypeScript, PostgreSQL and Prisma. Exactly two accepted rules use exact current order value and per-line current quantity. Explicit settings without default thresholds, inbox, evidence/history and Open in Shopify. Resolve/Ignore change app alerts only and remain closed under reevaluation. No AI, customer messaging or Shopify order mutations.

Server authentication, encrypted minimal snapshots, durable ingestion, bounded synchronization, tenant-isolated decisions and privacy processing are implemented. **233 local tests pass**, including a predetermined persisted-setting/normal-pipeline release dataset. The local in-app browser hydration defect and stale inbox row after two-tab conflict recovery are repaired. Synthetic browser actions/settings/failure/unknown checks pass. [Functional evidence](docs/QA-FUNCTIONAL.md) separates local tests from current Shopify E2E.

P08 real Shopify Admin/App Bridge workflow, P04 remaining live cases and P09 actual privacy registration/delivery/dev setup stay open. Production access, identity/contact, hosting/encryption/backups, secure export delivery and journal custody are unresolved; the Prisma/deepmerge production advisory still requires supported remediation. **Not production or App Store ready.** Full P10A/P10B gates remain open. The independent local P10B envelope passes:180 synthetic orders plus36 duplicates, recovery and actual isolated backup/restore; this is not real merchant capacity. See [reliability evidence](docs/QA-RELIABILITY.md). Source publication does not deploy or change Shopify settings.

- [Status](docs/STATUS.md), [next task](docs/NEXT.md), [changelog](CHANGELOG.md)
- [Local setup](docs/LOCAL-SETUP.md), [merchant workflow](docs/P08-MERCHANT-WORKFLOW.md)
- [Rules](docs/RULES.md), [lifecycle](docs/P07-LIFECYCLE.md), [architecture/inventory](docs/ARCHITECTURE.md)
- [Privacy evidence](docs/PRIVACY-EVIDENCE.md), [policy draft](docs/PRIVACY-POLICY.md), [support](docs/PRIVACY-SUPPORT.md)
- [Ingestion](docs/P03-INGESTION.md), [sync](docs/P04-SYNC.md), [roadmap](docs/ROADMAP.md)

Synthetic checks: npm ci, npm run db:generate, npm test. Browser harness: npm run build, then node scripts/ui-test-server.mjs; open http://127.0.0.1:3108/__test. It uses a fresh disposable database, fake transport and real SDK authentication, not a live Shopify session. Never reset an existing database or invent merchant thresholds. P09 requires PRIVACY_LEDGER_KEY/PRIVACY_JOURNAL_PATH and a separate worker; read setup/provenance constraints before applying to existing data.

This portable source excludes linked account configuration, credentials, databases, machine identities and private operational history. See [publication boundaries](docs/PUBLIC-REVIEW.md).
