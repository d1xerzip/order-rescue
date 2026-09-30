# Order Rescue

A read-only Shopify embedded app for reviewing order exceptions. Version **0.7.0**.

React Router, TypeScript, PostgreSQL and Prisma. Two accepted checks use exact current order value and per-line current quantity. The merchant workspace provides explicit settings without default thresholds, an exception inbox, current/decision evidence, history and Open in Shopify. Resolve and Ignore change only our alert and remain closed under reevaluation. No AI, customer messaging or Shopify order mutations.

Server-verified authentication, encrypted minimal snapshots, durable ingestion, bounded synchronization and tenant-isolated decisions are implemented. 189 local tests pass. The actual production build was browser-tested with synthetic shops and a disposable database; this is not proof of the real embedded Shopify workflow. Live P08 verification, remaining P04 cases, complete privacy processing and production access/deployment remain open. **Not production or App Store ready.**

- [Status and blockers](docs/STATUS.md), [next task](docs/NEXT.md), [version history](CHANGELOG.md)
- [Local setup](docs/LOCAL-SETUP.md), [P08 workflow and browser evidence](docs/P08-MERCHANT-WORKFLOW.md)
- [Rule contracts](docs/RULES.md), [lifecycle](docs/P07-LIFECYCLE.md), [architecture/inventory](docs/ARCHITECTURE.md)
- [Ingestion](docs/P03-INGESTION.md), [synchronization](docs/P04-SYNC.md), [roadmap](docs/ROADMAP.md)

Local synthetic workflow: `npm ci`, `npm run db:generate`, `npm run build`, then `node scripts/ui-test-server.mjs`; open `http://127.0.0.1:3108/__test`. This creates a fresh disposable database, uses fictional shops and does not load a real env file. Stop automated tests before using its test database port. Use LOCAL-SETUP for real development configuration; never reset an existing database or invent merchant settings.

This portable source edition excludes linked account configuration, credentials, databases, machine identities and original private Git history. See [publication boundaries](docs/PUBLIC-REVIEW.md) and [license](LICENSE.md).
