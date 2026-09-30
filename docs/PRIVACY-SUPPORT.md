# Privacy support procedure — DRAFT

2026-09-30. Operational procedure for the implemented local controls; not a legal approval or authorization to send messages, alter Dashboard answers, deploy, or delete live merchant data. Owner/legal identity, responsible operator, privacy/support contact and escalation channel remain **UNRESOLVED**. In P09, deletion and restore tests use synthetic records in a separate disposable database only.

## Receive and monitor

1. Keep the HTTPS privacy ingress and separate `worker:privacy` available independently of ordinary order processing and active Shopify sessions. Verify the environment and migration state using [LOCAL-SETUP.md](LOCAL-SETUP.md); do not run deletion against the development/live merchant database as a test.
2. The handler checks original-byte HMAC before parsing or writing. Invalid signature returns401; unavailable durable storage returns503. Record only operation/status/count/time in operational logs; do not copy raw payloads, tokens, customer contacts or routing IDs into tickets/screenshots.
3. Inspect pending, processing, retry and failed privacy receipts in a restricted operator environment. `privacyStatus()` returns safe counts for backlog, failed work, awaiting handoff and overdue work without routing IDs or payloads. Awaiting-handoff requests remain overdue after export expiry; preparation cannot hide an undelivered obligation. Track age from receipt, attempts, safe error code and completion separately from export delivery. Shopify requires action within30days; escalate unresolved work well before the deadline. Failed work must not be discarded. Investigate storage, journal/key access and worker availability; after fixing the cause, explicitly retry with the existing receipt, preserving its original receipt time.
4. Duplicate delivery is deduplicated by shop/topic/delivery identifier. Different deliveries can repeat the same obligation safely. Customer membership comes from the authenticated Shopify order list within the verified shop; do not infer membership from counts, email or caller-supplied foreign IDs.

## Data request and handoff

The worker prepares encrypted order evidence, evaluations and exception history for listed, retained orders. Staff actor identity is omitted from customer export evidence. Missing/expired/deleted records are not fabricated; a genuinely empty eligible result is distinct from failed processing. The export is limited in size and expires within7days, capped by the earliest included order expiry.

`getPrivacyExport(verifiedPrincipal, receiptId)` is a server-only, shop-scoped function requiring current authenticated context. No public download route or support delivery UI is implemented. A completed receipt means preparation finished; `deliveredAt` must not be treated as set by the worker.

Before any delivery, independently authenticate the merchant and matching request, review the scoped artifact, use an owner-approved secure channel and arrange delivery while the artifact is valid. Actual recipient verification, channel and handoff mechanism are **UNRESOLVED** production prerequisites. Prepare an external message for review; send only with specific authorization. After the separately authorized handoff was actually observed, call server-only `markPrivacyExportDelivered(verifiedPrincipal, receiptId, true)`: it verifies shop/current access and export validity, then records `deliveredAt` and encrypted actor, predefined reason and time. Reading/preparing an export alone does not authorize that call. No external delivery or publication happens automatically. Uninstalled merchants cannot use the active-shop export function; escalate an authenticated support handoff rather than bypassing tenancy or inventing delivery evidence.

## Redaction and lifecycle

Customer redaction removes snapshots and cascaded evaluations/exceptions/history, order jobs and read locks; it resets the shop's sync checkpoint and invalidates prepared exports. Completed redaction receipts no longer retain plaintext erased order lists. Shop redaction additionally removes current shop/installation data, settings, workspace, credentials and lifecycle deliveries. Minimal privacy receipts and keyed deletion metadata follow their separate retention policy.

Do not ignore an authentic `shop/redact` because the merchant reinstalled. The signed body supplies no generation, so the implementation conservatively purges the current tenant; a triggered-at header cannot override this policy. Explain the loss of app state if needed, without claiming a Shopify order was changed. A later verified install may start new app state; queued/retried work cannot restore redacted orders.

If journal persistence fails, stop deletion processing and ordinary access through the existing fail-closed guards; repair the journal/key/storage cause without clearing markers. After a crash following journal flush but before database commit, retain the marker and retry the same obligation. This may temporarily block more work; deleting the journal to recover service is forbidden by this procedure.

## Retention, backup and restore

Run both privacy and order maintenance. Check removal of expired order-derived rows, expired exports and completed redaction receipts older than30days. Completed data-request receipts qualify for purge only when `deliveredAt` is set; undelivered receipts remain awaiting handoff and can become overdue even after export expiry. Escalate expired undelivered work rather than falsely marking it delivered. Unresolved receipts and deletion hashes have an explicit safety hold, requiring operator/owner review; never claim they auto-expire. No legal hold is configured. Any future legal exception requires a documented applicable obligation and separate review.

Encrypted backups with maximum7day retention remain a proposal. Production owner/provider must establish region, encryption, access restrictions, retention, secure disposal and independent journal durability/rollback protection. Application hashing/signatures alone cannot detect loss of a whole valid journal suffix. Never restore an old journal alongside an old database as if it were current.

Restore procedure: keep server/ordinary workers and merchant access offline; validate that the current independent journal and its key are present and authentic; restore the database in isolation; invoke `applyPrivacyJournal()` to replay deletion markers, purge erased data/exports and expired snapshots; then reconcile current installation/scope state with authoritative evidence before enabling ordinary access. Preserve the newer journal throughout. If current journal completeness cannot be established, keep access blocked and escalate. P09 evidence must distinguish synthetic restore checks from unverified provider backup/restore.

## Production review checklist

Read-only verification must establish active compliance subscriptions and delivery evidence; CLI-generated payloads do not prove registration. Obtain actual production PCD approval separately. Resolve legal identity/contact, merchant agreement, provider/region, volume encryption, database TLS, logs/TTL, staff access, backup horizon, journal protection, secure export delivery and incident response. Reassess questionnaire answers from evidence with owner agreement; do not save/submit them under this procedure. Preserve outstanding P04/P08 live and browser checks in STATUS.
