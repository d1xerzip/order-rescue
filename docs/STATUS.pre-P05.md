# Public source status

Version **0.2.0**, P04 bounded synchronization implemented and verified within the scope below. This portable checkout is not linked to a Shopify app or independently live-verified. It is **not production ready**.

## Changed

Added authenticated orders/updated and orders/cancelled intake, authoritative rereads, durable per-order read leases, stable full-snapshot comparison, initial synchronization and periodic reconciliation. Eligible orders remain limited to the current installation boundary and 30 days. No extra personal fields, scopes, historic backfill, rules or product UI. See [synchronization](P04-SYNC.md) and [changelog](../CHANGELOG.md).

## Verified

- 42 relevant synthetic tests passed across targeted runs: snapshot 9, discovery 5, API transport 8, ingestion 10, synchronization 6 and updates 4. These are cumulative executed results, not a claim of one 42-test command.
- Typecheck, lint and build passed. Migration was exercised in disposable PostgreSQL before the local development database.
- The private development workflow performed real GraphQL synchronization in two development stores. Each produced one matched order; IDs and approved fields were compared with an independent authoritative reread, not only counts.
- P03 genuine order-created delivery evidence remains valid. Installation checks were not repeated. Operational identifiers, raw data and private receipts are not included here.

## Not run / blockers

Actual update/cancellation webhook delivery and multi-page live synchronization remain NOT RUN. Local synthetic topic, race, cancellation, partial-fulfillment, pagination and recovery cases passed. Production approval, complete privacy processing, merchant disclosures, production encryption/backups and hosting remain unfinished. A successful local or development-store check does not establish production readiness.

## Next step

P05: implement deterministic rule-input/outcome types and eligibility, with exact decimal/quantity semantics and explicit unavailable results. See [next task](NEXT.md). Actual evaluations belong to the following milestones. Prior reports and older roadmap statements naming recovery as the next slice are preserved as historical claims and superseded by this status.
