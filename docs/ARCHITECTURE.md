# Architecture and data inventory

P03 update: order-created ingestion is now implemented; P03-INGESTION.md and STATUS.md supersede earlier statements below that order persistence/workers are only planned. Account-specific access must still be independently configured by each operator.

Implemented stack: React Router/TypeScript server and UI, PostgreSQL/Prisma. Authenticate via the official Shopify SDK; bind tenant access to verified session context. Session credentials are encrypted server-side. Tenant records are queried and mutated with server-derived shop constraints.

Installed-state/generation guards disable ordinary work after uninstall. Privacy webhook intake is independent of active API credentials. It stores minimal pending receipts; export/redaction/retention/restore are not implemented. P03 now implements order-created jobs and snapshots; see P03-INGESTION.md. Future workers must reconcile current granted scopes rather than trusting reordered scope webhook payloads, and recheck generation before committing.

The following ingestion/retention mechanisms are proposals, not deployed behavior.

## Proposed flow and reliability
Webhook → authenticate → durable minimal job in DB → acknowledge → worker fetches minimal current GraphQL snapshot → normalize/evaluate → commit order and alerts. Store identifiers needed to fetch, not raw order payloads. Snapshot retrieval must finish all line pages and detect concurrent order changes; bounded retries yield `unknown`/retry, not partial success. Inspect HTTP failures and GraphQL `errors` even on HTTP 200.

At P03 verify delivery/event identifiers and topic semantics from current webhook docs before choosing the uniqueness key. Use database uniqueness, per-shop/order serialized work, bounded retries, leased claims and safe crash recovery. Order/evidence updates and job completion must have defined transaction boundaries. Dedup retention is not the only safety mechanism: a late duplicate still cannot duplicate an alert or reopen a decision.

P04 recovery reads only eligible orders (current installation, created within 30 days); persistent cursors advance only after durable completion. Overlap windows and current snapshots handle missed/reordered deliveries. API denial, expired access or missing records never means a successful zero-result scan. Expose last successful scan, coverage gaps and stale evidence.

Uninstall disables ordinary jobs and invalidates credentials; required privacy processing remains available independently of the Admin API token. Reinstall starts a new installation generation and monitoring boundary. Old ordinary queued jobs cannot run under the new installation. Privacy requests are not ordinary jobs: a generation change must not silently discard them. Match delayed privacy delivery to its deletion obligation without blindly deleting unrelated new-installation data. Verify Shopify reinstall/delayed-delivery semantics and test this in P09 before production.

## Minimal data inventory — proposed allowlist
Access `O` means `read_orders` plus protected-customer-data access for the actual environment. This source edition has no linked account or verified order access. The following inventory is a proposed allowlist, not stored order data.

Retention `R`: expire order-derived rows at `createdAt + 30 days`, regardless of status/update; delete sooner for verified redaction. `S`: active installation only, then purge on uninstall cleanup / shop redaction. Actual cleanup and backups must be verified before production.

| Field / local group | Purpose / rule | Scope/access | Retention | Deletion path |
|---|---|---|---|---|
| Verified shop identity/domain; installation generation; monitoring start/status | Tenant routing, trusted Admin link, lifecycle | Authenticated installation; verify shop mapping in P02 | S; minimal deletion ledger separately below | shop/redact; disable on uninstall |
| Encrypted offline/session credentials, expiry and granted-scope metadata | Auth and background read access; no rule | Official auth lifecycle; server only | Only while necessary for active installation/session | revoke/delete on uninstall/expiry; shop purge |
| `Order.id`, `legacyResourceId` | Dedup, privacy lookup and Admin link; both rules | O | R | Cascade order, lines, alerts, jobs and evidence |
| `Order.createdAt`, `updatedAt`, `cancelledAt` | Eligibility, revision and cancellation; both rules | O | R | Same order cascade |
| `currentTotalPriceSet.shopMoney.amount`, `currencyCode` | Exact monetary comparison/evidence | O; high_order_value | R | Same order cascade |
| `lineItems.nodes.id`, `currentQuantity` | Per-line quantity evidence, without title/SKU | O; high_line_quantity | R | Same order cascade |
| `pageInfo.hasNextPage`, `endCursor`, snapshot-complete flag | Complete pagination; both rules' availability | O; transient query metadata | Cursors only during job; completeness with R | Job completion/purge; order cascade |
| Rule enabled/threshold/currency/config version | Merchant settings and deterministic comparison | App-local authenticated shop; no Shopify write scope | S; referenced version only within R | Shop purge; expired evidence cleanup |
| Outcome, reason, timestamps, threshold/value/line-ID evidence, alert status/decision version/time | Explain check and persist merchant review | Derived PCD, same tenant controls as O | R, including terminal alerts | Order/customer/shop purge |
| Job event/topic/order ID, attempt/state/lease, safe error code; sync cursor | Retry/recovery; no raw customer body | Verified delivery or authorized job | Job max 7 days, never beyond R; sync cursor S | Completion cleanup, order/shop purge |
| Privacy topic/request ID + listed order IDs | Data request/deletion routing | Verified compliance webhook, no extra customer-read scope planned | Delete working job after completion; max 30 days | Completion and privacy purge |
| Deletion ledger: keyed hash of shop/order, installation generation, deletion time | Prevent replay/restore resurrection; still sensitive metadata | Privacy worker only; not merchant evidence | Proposed 30 days after deletion, at least backup horizon | Expire only when backup/job/import safety checks pass |
| Structured operation codes, counts, timings | Reliability diagnostics, no business rule | Internal restricted telemetry | Proposed 7 days | TTL; never include tokens, payloads or order/customer identifiers |

No customer names, address, phone, email, `Customer.id`, notes, tags, IP, product titles, SKU, payment details, transaction or fulfillment data are selected or persisted. Display stable order/line identifiers instead of collecting descriptive customer fields. Privacy payloads may contain PII: authenticate in memory, extract only allowlisted routing fields and discard the rest. Missing/redacted API fields retain an explicit unavailable reason; do not replace them with empty values.

Pagination completeness governs the quantity rule; an incomplete line page does not invalidate independently available value data (R14). Preserve exact decimal strings and identifiers. Encryption of stored tokens does not establish encryption of future order snapshots. Order persistence and order/job TTL are implemented in P03; complete privacy deletion remains incomplete.

## Retention/deletion design and tests
Propose daily TTL cleanup; expiry is also enforced on reads and ingest so deletion lag cannot extend coverage. A request on `customers/data_request` looks up only the verified shop's `orders_requested`; redact uses `orders_to_redact`. No customer identity table is needed for this allowlist. Unexpected/malformed ID lists are unresolved privacy work, never a fabricated “no data” result. See official payload evidence in [PLATFORM-SOURCES.md](PLATFORM-SOURCES.md).

Deletion atomically blocks new work and cascades to all derived copies; workers check the deletion ledger before fetch and before commit. `shop/redact` purges the tenant, and late events without an active installation are rejected from ordinary processing. Export only to the authenticated merchant via an audited support workflow; no automatic external message.

Propose encrypted backups with maximum 7-day retention. Restore remains offline until the separately preserved deletion ledger is applied, expired rows removed, and installation state reconciled. Ledger hashes are not anonymous; keep access limited and document their sole purpose. A retention exception needs documented justification; do not invent one. If provider/backup behavior cannot meet this design, block production data rather than claim compliance. P09 must test concurrent deletion, queued retries, expiry, reinstall and restore. These are design choices, not a legal approval or a statement of current controls.


P05 adds contract/fixture artifacts only. No data fields, scopes, persistence or retention changes. P04 evidence and privacy limitations remain.


P06A reconciliation: only high_order_value is now implemented, preserving P05 semantics. Earlier no-rule statements describe prior milestones. See [implementation/evidence](P06A-HIGH-ORDER-VALUE.md); merchant settings/evaluation persistence remains absent, results are internal/transient. Next P06B; P04 live limitations remain.
