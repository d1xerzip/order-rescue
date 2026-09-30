# P07 exception lifecycle — transition contract

Written before implementation, 2026-09-29. Preserves P05 and RULES.pre-P05.md R09–R13: terminal merchant decisions never automatically reopen in V1. Acknowledged adds an explicit non-terminal review step requested for P07. No risk/fraud score. Review priority is `review`, the same for both rules; outcome and freshness convey data quality independently.

## Transition table

| Existing review state | Input | Next state / behavior |
|---|---|---|
| No exception | matched | Create one open exception for shop + order + rule |
| No exception | not_matched / not_applicable / unknown | Save latest evaluation, do not fabricate exception |
| open | acknowledge | acknowledged; audited merchant decision |
| open / acknowledged | resolve | resolved; reviewed, not repaired |
| open / acknowledged | ignore | ignored; intentionally dismissed |
| any existing state | identical evaluation | Same identity/state; no duplicate history or active work |
| open / acknowledged | changed matched evidence or versions | Keep review state; replace current evaluation and append versioned observation |
| open / acknowledged | signal disappears / disabled / unknown | Keep review state; clearly show current result, no automatic Resolve |
| resolved / ignored | any new evidence/settings/rule version or condition returns | Keep terminal decision and its evidence; update separate current evaluation/history; never reopen |
| resolved / ignored | new merchant state action | Reject conflict; no reopen endpoint in V1 |
| any | stale revision action or two competing actions | Exactly one expected-revision action succeeds; other gets 409 |
| any | wrong shop / expired / old installation / privacy-blocked order | 404 without evidence or mutation |

Stable exception identity: database unique (shopId, orderId, ruleKey), independent of delivery ID. Current installation generation gates access; expired/verified-deleted snapshots cascade all derived evaluation/exception/history. Existing old-generation identity is never repurposed. Current coverage normally prevents the same order being monitored after reinstall.

Material observation fingerprint includes rule key/version, settings version, outcome/reason, evidence and exact sourceSnapshotVersion, excluding evaluation wall-clock time. A changed fingerprint adds an observation and advances optimistic revision; it never clears a terminal decision. Identical observations may refresh last checked time without another history row. Decision history stores actor from verified Shopify token sub (encrypted, not name/email), server time, enumerated action reason, prior/next state, relevant rule/settings/source versions and evidence as seen by actor. No free-text customer data accepted.

Settings writes validate explicit enabled/threshold/currency with existing validators; no merchant threshold or currency defaults. Server assigns immutable settings version; expectedRevision avoids lost writes. Settings change marks older evaluation stale until the existing order processing path re-evaluates; no automatic bulk backfill. Unconfigured rules stay NOT_CONFIGURED. Current evidence is distinct from decision evidence.

Reads expose latest evaluations including unknown and freshness reasons (settings changed, pending/retry/failed processing, synchronization gap). Failed API work does not overwrite last evidence with success or pretend order is safe. Source older than the winning snapshot cannot overwrite current evaluation: only the existing fenced worker transaction persists results against its winning stored snapshot. Equal source timestamps use content digest, not timestamp alone.

## Implementation boundary

One durable path: existing job -> winning snapshot + latest persisted shop settings -> both evaluators -> latest results/exception/history in the same PostgreSQL transaction; job completion remains a separate fenced transaction, so crash replay must be idempotent. Merchant actions/settings writes serialize on the same Shop row and recheck active generation. Every HTTP read/action independently verifies Shopify auth; actions require Authorization bearer and JSON. No Shopify mutation, UI, new rule, live migration or deployment authorized by this document.

Settings persist for current installation and are removed on uninstall cleanup; old versions survive only in encrypted order-derived evidence within original createdAt+30days. All order-derived records cascade from OrderSnapshot and are filtered for expiry on reads/actions. Full privacy processing/restore remains P09; pending redaction blocks reads/actions as well as worker recreation.

## P07 actor and action boundary — checked 2026-09-29
Official [authenticate.admin](https://shopify.dev/docs/api/shopify-app-react-router/latest/authenticate/admin) documentation and [ID tokens](https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens) opened this turn: sessionToken is decoded/validated by the official helper; sub identifies the authenticated user. Installed SDK declaration also exposes sessionToken.sub. P07 records only that opaque actor ID with tenant binding and encrypted decision detail, never name/email or a token. Resource actions require a bearer token and application/json; no cookie/query-only action authorization. No new Admin API scope, mutation or account configuration.

## Implemented storage and transaction boundaries — 0.6.0

- RuleSetting: one current encrypted configuration per shop/generation/rule, revision and server-generated immutable settingsVersion. Enabled, threshold and value currency must be supplied; absent rows have no threshold. Configuration writes validate existing pure-rule validators and use expectedRevision (0 for first save); conflicting writes return 409. Latest configuration is loaded after the worker locks Shop, even if settings changed during Shopify fetch.
- RuleEvaluation: one encrypted latest result per shop/generation/order/rule, database FK to that tenant's OrderSnapshot. Both rules share the winning snapshot/digest and evaluation time. checkedAt may refresh on identical evaluation; semantic fingerprint and history stay unchanged.
- ExceptionRecord: unique shop/order/rule, state, revision and snapshot FK. ExceptionHistory stores encrypted observation or decision detail, timestamp and unique monotonically increasing exception revision. Revision order resolves equal-time audit ordering. Decision detail has actor, action, enumerated reason, from/to state, full versioned result and freshness as seen at the decision; observation detail has the current versioned result.
- Snapshot write, settings lookup, evaluation, exception transition and history append are atomic in the existing locked transaction. Job completion stays separately lease-fenced: a crash after the durable transaction but before completion leaves replayable work and already-consistent evidence. Explicit settings injection retained for older fixtures is guarded by RUN_MODE=test plus ORDER_RESCUE_DISPOSABLE_TEST_DB=1 and is transient; ordinary workers always use persisted settings and save results.
- All service reads/actions lock lifecycle advisory mutex then Shop row, recheck active generation, hide expired or pending-redaction order data before decryption. Settings writes serialize with worker/action transactions. Pending shop redaction hides all records. Uninstall clears current settings; old evidence is inaccessible and remains subject to original expiry and verified deletion obligations.
- Snapshot deletion cascades latest results, exception and all history. Existing purgeExpiredOrders applies original createdAt+30days, never extends life on new evidence/actions. No new customer fields, Shopify scopes or Shopify mutations.

## Resource API for P08

Each request requires an independently verified Shopify bearer ID token. Actor is its verified sub, never JSON/query identity. Responses have Cache-Control: no-store. JSON mutation bodies are limited to8192 bytes and reject unrecognized fields. Foreign/nonexistent/expired exceptions return the same empty404; stale revisions or disallowed transitions409. Invalid configurations400. No cookie/query-only mutation authorization.

| Method/path | Input / response |
|---|---|
| GET /api/rule-settings | Current explicit settings and revisions; absent rows are unconfigured |
| PUT /api/rule-settings | {ruleKey, settings:{enabled,threshold,currencyCode for value}, expectedRevision} |
| GET /api/evaluations | Latest results including unknown/not_applicable, order IDs and freshness reasons |
| GET /api/exceptions | Exception records with current results and separate history |
| GET /api/exceptions/:id | Own visible exception, revision, priority=review, current result, freshness and history |
| POST /api/exceptions/:id | {action,reason,expectedRevision}; acknowledge/REVIEW_STARTED, resolve/REVIEW_COMPLETED or ignore/NOT_RELEVANT |

Freshness codes: SETTINGS_CHANGED, PROCESSING_DISABLED, PROCESSING_PENDING, PROCESSING_IN_PROGRESS, PROCESSING_RETRY, PROCESSING_FAILED, SYNCHRONIZATION_GAP. A synchronization gap includes missing/current-generation unsuccessful sync, error, active run or overdue next run. Unknown stays an evaluation outcome even when other freshness reasons are absent. Historical failed jobs conservatively remain visible until cleared/expired. No claim of safe orders. Current list/history endpoints return complete visible sets; pagination and bounded response design must be added with P08 before scaling beyond the small development dataset.

## Verified synthetic before/after records

These are assertions from the executed integration test named `ignored material changes preserve decision evidence separately from latest observation`, not live merchant data. The same generated exception ID, order ID, rule key and settings version are retained throughout. CAD100.00 is only its fixture threshold.

| Operation | Current amount | Current outcome | Review state | Revision | History rows |
|---|---|---|---|---|---|
| First matching snapshot S1 | 100.01 | matched | open | 1 | 1 observation |
| Ignore with expectedRevision1 | 100.01 | matched | ignored | 2 | 1 observation + 1 decision |
| Equal-time changed snapshot S2 | 250.00 | matched | ignored | 3 | 3 |
| Signal disappears, snapshot S3 | 20.00 | not_matched | ignored | 4 | 4 |
| Signal returns, snapshot S4 | 500.00 | matched | ignored | 5 | 5 |

The original decision still contains actor=synthetic-merchant-7001, action=ignore, reason=NOT_RELEVANT, fromState=open, toState=ignored, ruleVersion=1.0.0, original settingsVersion and S1 digest/evidence amount100.01. S1–S4 are explanatory aliases for the actual canonical digests, not new persisted fields. Assertions compare the complete original decision object before/after later observations. Another executed test verifies open -> acknowledged -> resolved with two actor/timestamp/versioned decisions. All permitted resolve/ignore transitions from open/acknowledged and terminal/repeated-acknowledge conflicts are tested.

Reproduce with `npm test -- tests/exception-lifecycle.test.ts` using the repository's disposable DB runner. This narrower command is provided for reproduction; the executed acceptance command was the full `npm test` below.

## Executed evidence — 2026-09-29

- npm run db:generate — PASS, Prisma client6.19.3; repeated once after adding history revision uniqueness. No live migration.
- npm test —183/183 PASS in one full run on a fresh disposable PostgreSQL database at loopback port55433; all four migrations applied there.21 new cases (15 lifecycle/integration and6 HTTP/auth), plus162 existing rule/auth/storage/ingestion/sync regressions.
- Concurrency test starts two independent Node processes/Prisma connections behind an IPC ready/go barrier: exactly one200 and one409, one audited decision. Worker duplicate/concurrent receipt, stable identity and crash-after-write replay pass.
- Tests also verify settings changes during fetch, absent/invalid configuration, two-shop distinct settings, stale snapshot protection, equal-time changed content, unknown visibility, disabled/cancelled/disappearing signals, settings/processing staleness, foreign-ID read/action rejection, expiry cascade, pending redaction and inactive/reinstalled installation isolation.
- HTTP tests invoke resource handlers through the actual installed Shopify authentication SDK with synthetic signed JWTs and strictly mocked network. They verify no/invalid/expired bearer, actor spoof, foreign404 with empty body, own read/action, versions, request size/type and body restrictions. This is local authentication/integration evidence, not a real Shopify browser test or live HTTP deployment.
- npm run typecheck; npm run lint; npm run build — PASS after final code changes. Existing empty resource-route chunks and React Router future-flag warnings remain nonfatal. Targeted ESLint checks also passed for new service, routes and tests during implementation.
- Primary review corrected ambiguous timestamp/UUID history ordering before DB tests by adding unique audit revisions. No full-test failures occurred.

## Not run and next dependencies

Live/dev database migration, configured real-store lifecycle actions, browser/UI verification and deployment: NOT RUN. No installation cycles repeated; local regression tests of foundation are not a new live install test. No real thresholds saved. Previous P04 real update/cancel delivery and live multi-page sync limitations remain NOT RUN. P09 full privacy processing/restore, production approval and hosting remain open.

P07 local backend slice is complete. P08 may implement settings/inbox/detail/evidence/actions on these authenticated APIs after explicit start, add bounded pagination, and perform actual UI acceptance. Applying the additive migration to a chosen development runtime and setting an explicit merchant threshold must precede live P08 use. This source release alone does not migrate, configure or deploy a store.


P08 reconciliation (0.7.0): merchant onboarding/settings/inbox/detail/evidence and server-confirmed decisions now exist, with bounded API pagination and synthetic browser verification. Previous UI-unimplemented/unmigrated-dev statements are historical; existing dev data was preserved during the additive migration. No real thresholds were saved. See [P08 workflow and evidence](P08-MERCHANT-WORKFLOW.md). Real embedded Shopify acceptance remains NOT RUN; P09 is the next independent slice.

P08 API supersedes earlier unpaginated responses: GET lists return {items,nextCursor}; detail history uses historyCursor and historyNextCursor, plus independent latestDecision. Default20/max50; cursors never replace authentication.
