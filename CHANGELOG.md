# Changelog

## 0.8.2 — P10B local reliability and recovery

- Bound excessive retry hints and cover fifth-crash exhaustion without duplicate effects.
- Verify233 tests, bounded three-shop synthetic HTTP load, real worker crash/DB outage and checkpoint recovery; compare exact tenant/rule identities and snapshot fields.
- Execute actual PostgreSQL backup/restore to a distinct disposable database with current independent deletion journal; verify settings/history and v0.8.1 server-source compatibility on current schema.
- Apply supported Vite esbuild0.28.2 override;4high Prisma/deepmerge audit entries remain.
- Typecheck/lint/generation/build PASS. Full P08–P10 Shopify/provider/privacy gates remain open; no production readiness, live deletion, account edit or deployment.

## 0.8.1 — P10A local QA and workflow repairs

- Repair reproduced local IAB hydration with compatible React/runtime/types19.3.0 and the normal React Router entry.
- Refresh both inbox row and detail after server-confirmed two-tab conflict recovery; preserve lifecycle semantics.
- Add13 predetermined acceptance fixtures through persisted settings, existing order worker, exact snapshots/evidence and authenticated HTTP checks; verify17 targeted and231 total tests.
- Verify synthetic browser decision/reload, settings keyboard save,503 recovery, unknown/stale state and foreign404; typecheck/lint/generation/build PASS.
- Full P10A Shopify gate remains open; only independent local P10B may proceed. P08/P04 live and P09 registration/dev/provider/privacy blockers retained; production audit findings remain unresolved. No live deletion/restore, account change or deployment.

## 0.8.0 — P09 privacy lifecycle

- Authenticate original privacy bytes; durable leased processing, scoped encrypted export and confirmed-handoff audit.
- Cascade customer/shop erasure, block queued/racing work and apply an independent deletion journal on offline restore.
- Minimize staff session PII; enforce expiry and retain failed/undelivered work visibly. Add factual privacy/support drafts and source/registration evidence.
- Verify214 synthetic/local tests including25 new privacy cases; typecheck/lint/build PASS. Existing dev data untouched.
- Real subscription/delivery, P08 live/hydration, P04 live and provider/legal/production gates remain open. No deployment/account change/live deletion.

## 0.7.0 — P08 merchant workflow

- Add onboarding, persisted explicit settings, inbox/detail/evidence, history and server-confirmed decisions using the existing design/authentication flow.
- Bound list/history queries and tenant-scoped cursors; keep current results and terminal decisions separate.
- Apply the additive dev migration without reset and verify existing rows unchanged; no real settings seeded.
- Verify189 tests, browser synthetic workflow, two-tab conflicts, failure states, pagination, keyboard/narrow layout and foreign requests. Include sanitized screenshots.
- Real embedded Shopify UI checks remain NOT RUN; in-app-browser hydration incompatibility remains pending. P04 live and P09 privacy/production gates are retained.

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
