# Changelog

## 0.3.0 — P05 contracts and fixtures

- Exactly two rule cards, four outcomes, applicability, evidence and immutable rule/settings versions.
- 48 synthetic expected cases and one authorization-boundary example; structural checks only, evaluator not implemented.
- Preserved current amount/per-line fields and P04 unexecuted live checks.

## 0.2.0 — P04 bounded synchronization

- Accept relevant order-created, updated and cancelled events through authenticated durable intake; reread authoritative approved fields instead of trusting event order.
- Serialize competing reads with durable per-order leases. Compare two complete snapshots, handle equal timestamps, and reject state older than the persisted revision.
- Add initial synchronization and periodic full-window reconciliation with inclusive boundaries, resumable checkpoints, transactional job creation and completion-gated cursor advancement.
- Keep the installation boundary, 30-day eligibility/retention and minimal approved field inventory. No historic backfill, additional scopes, rules or new UI.
- Add version-checked GraphQL transport, bounded backoff, throttle/cost pacing and authenticated synchronization status.
- Verification: 42 relevant synthetic tests passed across targeted runs; typecheck, lint and build passed. Actual GraphQL synchronization matched one order and its approved fields in each of two development stores.
- Not run: actual update/cancellation webhook delivery and multi-page live synchronization. Production privacy/access/infrastructure remain incomplete.

## 0.1.0 — foundation and P03 ingestion

- Embedded server authentication, encrypted session persistence, tenant-scoped records and installation lifecycle guards.
- Byte-authenticated orders/create receipt, durable PostgreSQL jobs, retry/crash recovery and minimal encrypted snapshots.
- Genuine order-created delivery and matching persisted snapshots verified in two development stores in the private development workflow.
- Published as a sanitized source edition. Original private history, account identities and operational data are excluded.

Versions describe source milestones, not Shopify production deployments or App Store approval. Prior milestone reports retain their original scope; current status supersedes earlier next-task statements.
