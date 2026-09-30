# Order Rescue

A read-only Shopify embedded app for reviewing order exceptions.

Version **0.6.0**. React Router, TypeScript, PostgreSQL and Prisma. Implemented: server-verified authentication, encrypted sessions, tenant isolation, durable order webhook intake, minimal encrypted snapshots and bounded initial/periodic synchronization.

Planned V1: two merchant-configurable checks (high order value and high line-item quantity), an exception inbox, evidence, Open in Shopify, Resolve and Ignore. Both rule evaluators and settings/exception persistence are implemented; merchant settings UI and the inbox remain unimplemented. Resolve and Ignore will change application records only. No AI, customer messages, refunds, cancellations or Shopify order mutations.

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

P05 adds [two rule cards and a shared result contract](docs/P05-RULE-CONTRACT.md), with synthetic expected examples. P06A/P06B implement both accepted rules.

[Historical P06A evidence](docs/P06A-HIGH-ORDER-VALUE.md): value evaluator acceptance; its persistence limitation was addressed in P07.

[Historical P06B evidence](docs/P06B-LINE-QUANTITY.md): both rule evaluators; its transient-result limitation was addressed in P07.

[P07 lifecycle and evidence](docs/P07-LIFECYCLE.md): explicit settings without default thresholds, stable exceptions, encrypted decision history and authenticated APIs. Ignore/Resolve remain terminal under reevaluation.183 local tests pass; live migration and UI acceptance remain NOT RUN. P08 UI is next.
