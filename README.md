# Order Rescue

A read-only Shopify embedded app for reviewing order exceptions.

Version **0.3.0**. React Router, TypeScript, PostgreSQL and Prisma. Implemented: server-verified authentication, encrypted sessions, tenant isolation, durable order webhook intake, minimal encrypted snapshots and bounded initial/periodic synchronization.

Planned V1: two merchant-configurable checks (high order value and high line-item quantity), an exception inbox, evidence, Open in Shopify, Resolve and Ignore. Rules and the inbox are not implemented. Resolve and Ignore will change application records only. No AI, customer messages, refunds, cancellations or Shopify order mutations.

This is a portable source edition. It contains no linked Shopify registration, live credentials, database, production deployment or original private Git history. It is **not production or App Store ready**. Privacy receipt intake is not complete privacy processing.

- [Local setup](docs/LOCAL-SETUP.md)
- [Current status](docs/STATUS.md), [next task](docs/NEXT.md) and [version history](CHANGELOG.md)
- [Ingestion](docs/P03-INGESTION.md) and [synchronization runbook](docs/P04-SYNC.md)
- [Product](docs/PRODUCT.md) and [rule contract](docs/RULES.md)
- [Architecture and data inventory](docs/ARCHITECTURE.md)
- [Development access proposal](docs/P03-ACCESS-PLAN.md)
- [Roadmap](docs/ROADMAP.md)
- [Publication boundaries](docs/PUBLIC-REVIEW.md)
- [License](LICENSE.md)

P05 adds [two rule cards and a shared result contract](docs/P05-RULE-CONTRACT.md), with synthetic expected examples. Rule evaluation is not implemented.
