# P08 merchant workflow — 0.7.0

2026-09-29. Local implementation and synthetic browser acceptance complete. Actual Shopify embedded workflow remains NOT RUN; source publication is not deployment or production approval.

## Behavior

The authenticated app home now renders the existing cream/green design with onboarding, explicit rule settings, inbox, current/decision evidence, bounded history and Open in Shopify. No new rules, ingestion path, customer fields or Shopify mutations. Absent settings have blank thresholds/currency and disabled controls; CAD100.00 and quantity5 exist only in explicit disposable fixtures.

Resolve closes our alert as reviewed; Ignore suppresses it as not relevant. Both remain terminal under changed evidence/settings, as accepted in P07. Acknowledge starts review. The screen waits for server confirmation, shows uncertainty on transport failure, and requires loading the latest record after conflict. Current evidence and evidence at the merchant decision are separate. Settings changes apply on the next normal order processing, not a new backfill.

Loading, no configured rules, empty inbox, unavailable checks without an exception, partial synchronization, stale evidence, session failure and write errors have distinct messages. No empty/unknown state claims an order is safe. The synchronization strip includes last success, backlog, recoverable failures and overdue status at refresh. Refresh is explicit; no claim of real-time updates.

## API and pagination

- GET exception/evaluation lists now return `{items,nextCursor}`. Default20/max50; UUID keyset order is stable, not chronological. Filtering by review state applies to loaded rows, explicitly labelled while more pages exist.
- Cursor validates shop, installation generation, endpoint and (for history) exception identity. It is pagination state, not authorization; every request still authenticates independently.
- SQL scans at most limit+1 before privacy filtering. An empty visible page can retain a continuation; the UI keeps Load more available.
- Detail accepts `historyCursor`, returns `historyNextCursor`, and exposes the latest decision independently of history pagination. Observation/decision history is revision-ordered.
- Open in Shopify derives from the verified stored shop domain and strict stored Order GID. Neither a caller-supplied tenant nor URL is accepted.
- Existing AppProvider/App Bridge and server SDK verification remain. Standard same-origin fetch carries App Bridge authentication in Shopify; Admin API credentials stay server-side. No Direct API Access or extra scope.

## Existing development database migration

The selected existing loopback dev database was positively identified before writes. With no app/worker using it, an AES-256-GCM encrypted logical backup of all existing rows was saved privately. Raw PostgreSQL row JSON strings preserved exact integer/decimal data. Only pending additive migration `202609290004_exception_lifecycle` was deployed. All pre-existing non-migration tables retained identical row counts and SHA-256 row-set hashes afterward. Four new tables were added; no reset, deletion or real merchant setting write. This verifies data preservation, not a tested restore procedure (P09).

Actual private commands: `npm run db:local`; `node --env-file=.env.local .local/p08-migrate-audit.mjs before`; `node --env-file=.env.local node_modules/prisma/build/index.js migrate deploy`; `node --env-file=.env.local .local/p08-migrate-audit.mjs after`. The private backup/audit helper is intentionally not published. Portable source uses the equivalent `0004_exception_lifecycle` migration; see LOCAL-SETUP before choosing a database.

## Executed local checks

| Command | Result |
|---|---|
| `npm test -- tests/exception-pagination.test.ts tests/exception-http.test.ts tests/exception-lifecycle.test.ts` | 27/27 PASS on disposable PostgreSQL |
| `npm test` | 189/189 PASS; existing rule/ingestion/lifecycle regressions retained |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS after fixing effect state updates |
| `npm run build` | PASS; existing React Router future-option/empty resource-chunk notices only |
| `node --check scripts/ui-test-server.mjs` | PASS |
| `node scripts/ui-test-server.mjs` | Actual production React Router build served locally with disposable DB, actual resource routes and SDK authentication; only synthetic Shopify transport |

The browser harness creates a fresh database on test port55433, random synthetic secrets and three allowlisted fictional shops; it never loads a real env file. Explicit QA controls create orders through the existing job/worker path, configure failures and probe foreign IDs. The loopback adapter supplies synthetic signed tokens; this is not proof of real App Bridge token delivery. QA selection is shared by its tabs; reload tabs after changing the selected fictional shop. Start it only after automated tests release the test port. Stop with Ctrl+C; no production or dev data is reset.

## Browser evidence (synthetic only)

Actual rendered UI, DOM and console inspected in Opera using browser tools. The in-app browser reproduced hydration errors and suppressed some QA navigation; the same production build in Opera had no app JavaScript/hydration warnings or errors before deliberate offline testing. A temporary diagnostic entrypoint was removed; no hydration suppression was shipped. The exact in-app-browser cause remains unresolved; its clean-console acceptance is NOT RUN/PENDING, not PASS.

| Scenario | Observed result |
|---|---|
| New fictional shop | Blank settings, onboarding, empty inbox and incomplete monitoring distinguished |
| Explicit settings then reload | Enabled CAD100.00 and per-line5 persisted; no default threshold |
| New order through normal queue | Order9103, CAD150.00, line quantity6; one exception per accepted rule |
| Evidence/link | Exact total/threshold and matching line shown; href matched fictional shop and Order9103; external Shopify navigation NOT RUN |
| Resolve / concurrent Ignore | Resolve confirmed; stale second-tab Ignore rejected409; Load latest showed Resolved; reload preserved it |
| HTTP503 | No success shown, prior Open retained; latest-record reload required |
| Single dropped socket | Browser transparently retried and server-confirmed Ignore; not counted as an unhandled failure |
| Full server outage | Only the disposable QA server stopped; Resolve showed unconfirmed-save error, remained Open, no false success |
| Settings conflict | First tab saved110.00; second120.00 rejected409 and preserved input; explicit reload restored110.00 |
| Changed evidence | Resolved remained closed; updated current amount/110.00 threshold differed from original decision150.00/100.00 |
| Unavailable/partial sync | Order9104 amount/lines unknown remained visible without fabricated matches; incomplete/stale warnings visible |
| List/history pagination | Inbox20 then29; closed-state filter retained the correct record; history20 then27; latest decision remained available |
| Two fictional shops | Other shop remained CAD100.00/5; foreign GET/POST404 and target unchanged |
| Keyboard/narrow layout | Tab focused Save, Enter saved; Enter opened evidence; 390px iframe with372px content/scroll width, no horizontal overflow |
| Console | No app JS/hydration error in final Opera tabs; deliberately unavailable transport shown separately |

Sanitized screenshots in [evidence/p08](evidence/p08): inbox-wide.png, review-evidence.png, settings-wide.png, settings-narrow.png, inbox-narrow.png, network-failure.png. They contain fictional shops/orders only, no browser chrome, account identities, paths or credentials. Screenshot timestamps reflect test display, not live orders.

## Platform references checked

2026-09-29: official [AppProvider](https://shopify.dev/docs/api/shopify-app-react-router/latest/entrypoints/appprovider) was read earlier in this task; subsequent opens failed. Installed provider source/types confirm the existing embedded/apiKey setup. Official [Resource Fetching API](https://shopify.dev/docs/api/app-home/v1.0/apis/authentication-and-data/resource-fetching-api) and [ID tokens](https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens) current indexed documentation confirms automatic bearer attachment for same-domain fetch. Direct page opens failed in the research tool; this limitation is recorded, not represented as a successful live integration or SDK upgrade. Existing versions and scopes are retained.

## Remaining gates

Real Shopify P08 workflow, navigation to an actual Shopify order, App Bridge frontend requests and console in the embedded Admin remain NOT RUN because browser access is denied. Installation cycles were not repeated. Dev DB migration alone does not configure rules or activate real-store evaluation; no real merchant thresholds were written. P04 actual update/cancellation deliveries and live multi-page synchronization remain NOT RUN. P09 full privacy processing/restore, production PCD approval, hosting and App Store review remain open. Next independent slice: P09 privacy processing; preserve these live acceptance gaps for P10.


P10A repair reconciliation (0.8.1,2026-09-30): the reproduced local IAB hydration defect now passes with compatible React19.3 and the normal React Router entry; no warning suppression. Load latest refreshes both list/detail after a stale409. Current synthetic action/reload/settings/failure/unknown checks pass; actual Shopify Admin/App Bridge/embedded hydration and actual order navigation remain NOT RUN. Details: [QA-FUNCTIONAL.md](QA-FUNCTIONAL.md). Historical failures/screenshots above retain their original environment/version.

## Follow-up 0.8.8 — bounded actual development evidence

[Manual acceptance matrix](P08-MANUAL-ACCEPTANCE.md) supersedes blanket NOT RUN for the specifically observed settings, ingestion/evidence, Resolve/Ignore reload, correct order link and current manual hydration observation. It preserves historical findings and separates owner screenshots/reports from read-only DB assertions. The form id/name Issue disappeared after the minimal markup fix. Remaining warnings and live failure/conflict/foreign-ID/viewport/provider/privacy/advisory gates remain open; P08 is not complete.

## Follow-up0.8.9 — current evidence by environment

[P08 acceptance reconciliation](P08-ACCEPTANCE-RECONCILIATION.md) supersedes older next-step/blanket gap statements. Owner390px readability and current synthetic layout/keyboard are verified. Prior negative tests retain their scope after source/log review; no new execution or Shopify PASS is implied. Actual embedded keyboard and real exception-ID isolation remain open; other stage/security/provider gates are unchanged.
