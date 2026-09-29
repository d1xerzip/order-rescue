# Order Rescue

A read-only Shopify embedded app foundation for reviewing order exceptions.

Version 0.1.0. React Router, TypeScript, PostgreSQL and Prisma. Implemented: server-verified Shopify authentication, encrypted session persistence, tenant-scoped application records, installation lifecycle guards, health/readiness routes and minimal privacy-webhook intake.

Planned V1: two merchant-configurable checks (high order value and high line-item quantity), an exception inbox, evidence, Open in Shopify, Resolve and Ignore. The last two actions change application records only. Order-created ingestion is implemented; rules and the inbox are not implemented. See [P03 ingestion](docs/P03-INGESTION.md). No AI, customer messages, refunds, cancellations or order mutations.

This is a portable source edition. It contains no linked Shopify registration, live credentials, database, production deployment or original Git history. It is not App Store ready. Privacy receipt intake is not completed privacy processing.

- [Local setup](docs/LOCAL-SETUP.md)
- [Current status](docs/STATUS.md)
- [Product](docs/PRODUCT.md) and [rule contract](docs/RULES.md)
- [Architecture and data inventory](docs/ARCHITECTURE.md)
- [Development access proposal](docs/P03-ACCESS-PLAN.md)
- [Roadmap](docs/ROADMAP.md)
- [Publication boundaries](docs/PUBLIC-REVIEW.md)
- [License](LICENSE.md)
