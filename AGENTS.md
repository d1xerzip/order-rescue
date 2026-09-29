# Project instructions

Use the existing React Router/TypeScript/PostgreSQL foundation. Read docs/STATUS.md and the task-specific document before changing code. Preserve unrelated changes.

Derive tenant identity from verified server authentication. Keep Shopify credentials server-side and out of logs. Use disposable synthetic fixtures. Resolve and Ignore affect app records, never Shopify orders. Do not add AI, messaging, billing or order mutations without a separately agreed scope.

Keep official platform documentation and implementation evidence distinct. A mock, syntax check, preview or build does not prove live Shopify access. Run proportionate checks; document failures and unexecuted checks. Never store raw customer payloads in diagnostics.

Production deployment, public publication, external messages, account changes and real charges require specific authorization. See docs/LOCAL-SETUP.md for commands, docs/ARCHITECTURE.md for security/data, docs/RULES.md for semantics and docs/P03-ACCESS-PLAN.md for development access.
