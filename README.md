# Order Rescue

A read-only Shopify embedded app for reviewing order exceptions. Version **0.8.0**.

React Router, TypeScript, PostgreSQL and Prisma. Two accepted checks use exact current order value and per-line current quantity. Merchant workflow includes explicit settings without default thresholds, inbox, evidence/history and Open in Shopify. Resolve/Ignore change app alerts only and remain closed under reevaluation. No AI, customer messaging or Shopify order mutations.

Server authentication, encrypted minimal snapshots, durable ingestion, bounded synchronization, tenant-isolated decisions and privacy processing are implemented. **214 local tests pass**, including25 privacy scenarios on synthetic records in a separate disposable database. Original-byte HMAC, scoped export/redaction, queue races and restore guards are verified locally. Prepared exports require a separately verified handoff.

Real privacy registration/delivery, P08 Shopify Admin/App Bridge checks, the in-app browser hydration issue and remaining P04 live cases stay open. Production access, identity/contact, hosting/encryption/backups and journal custody are unresolved. **Not production or App Store ready.** Source publication does not deploy or change Shopify settings.

- [Status](docs/STATUS.md), [next task](docs/NEXT.md), [changelog](CHANGELOG.md)
- [Local setup](docs/LOCAL-SETUP.md), [merchant workflow](docs/P08-MERCHANT-WORKFLOW.md)
- [Rules](docs/RULES.md), [lifecycle](docs/P07-LIFECYCLE.md), [architecture/inventory](docs/ARCHITECTURE.md)
- [Privacy evidence](docs/PRIVACY-EVIDENCE.md), [policy draft](docs/PRIVACY-POLICY.md), [support](docs/PRIVACY-SUPPORT.md)
- [Ingestion](docs/P03-INGESTION.md), [sync](docs/P04-SYNC.md), [roadmap](docs/ROADMAP.md)

Synthetic local workflow: npm ci, npm run db:generate, npm test. For the existing synthetic browser harness: npm run build, then node scripts/ui-test-server.mjs and open http://127.0.0.1:3108/__test. Never reset an existing database or invent merchant thresholds. P09 adds PRIVACY_LEDGER_KEY/PRIVACY_JOURNAL_PATH and a separate worker; read setup before running against existing data.

This portable source excludes linked account configuration, credentials, databases, machine identities and private history. See [publication boundaries](docs/PUBLIC-REVIEW.md).
