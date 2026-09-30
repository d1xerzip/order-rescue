# Changelog

## 0.6.0 — P07 exception lifecycle

- Persist explicit tenant rule settings and both results in the existing order transaction; no default merchant thresholds.
- Add stable exception identity, open/acknowledged/resolved/ignored transitions and encrypted revision-ordered observation/decision history. Preserve terminal decisions under changed evidence/settings.
- Authenticate settings/evaluation/exception read and action APIs; enforce revisions, tenant/installation isolation, expiry, privacy blocking and uninstall settings cleanup.
- Verify183/183 tests including separate-process action race, replay/crash and synthetic SDK HTTP authorization. Typecheck/lint/build pass.
- No UI, Shopify mutations, live DB migration or deployment. P04 live and P09 production/privacy gates remain.

## 0.5.0 — P06B high line quantity

- Add accepted per-line currentQuantity evaluator and shared applicability/configuration boundaries; preserve value semantics.
- Return both versioned results from one winning snapshot in the existing job path. No UI, extra rules or merchant defaults.
- Verify 87 pure tests, 11 rule integration tests and 29 affected regressions across targeted runs; typecheck/lint/build pass.
- Settings/results remain transient. P04 live limitations preserved; P07 local persistence is next.

## 0.4.0 — P06A high order value

- Implement pure high_order_value with exact BigInt decimals, accepted lifecycle/currency policy and tenant-bound configuration validation.
- Connect to existing order-job transaction and selected snapshot; canonical content version, completion-fenced transient result.
- Verify53 pure,8 integration and20 affected regression tests across targeted runs; typecheck/lint/build pass.
- Merchant settings persistence/UI, quantity rule and exceptions remain pending. No new Shopify fields/scopes or pipeline.

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
