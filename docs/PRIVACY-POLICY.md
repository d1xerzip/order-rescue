# Order Rescue privacy policy — DRAFT

**2026-09-30. Not published, not legally approved, and not a production attestation.** Owner/legal identity, privacy and support contact, hosting providers, processing region and merchant agreement remain **UNRESOLVED**. Reassess this draft against the deployed service before publication. Technical requirements and source dates: [P09 research](P09-PLATFORM-RESEARCH.md); verified controls and gaps: [privacy evidence](PRIVACY-EVIDENCE.md).

## Purpose and information

Order Rescue reads eligible Shopify orders to help merchants review two configured checks: high order value and high individual line-item quantity. Resolve and Ignore change app alerts only. The app does not edit orders, issue refunds, cancel orders, send customer messages or use AI. No data-sale, advertising or unrelated secondary-use integration is implemented.

The app stores verified shop identity and installation state; server-side credentials and access metadata; order/line identifiers, `createdAt`, `updatedAt`, `cancelledAt`, `currentTotalPriceSet.shopMoney.amount` and `.currencyCode`, and each line's `currentQuantity`; rule settings, evaluations, exception evidence and decision history. It does not select financial or fulfillment status. Merchant decisions include verified staff identifier, action, predefined reason, time and relevant versions. Thresholds are supplied by each merchant; no default price threshold is inferred.

Customer names, email, phone, addresses, product descriptions, raw webhook bodies and customer profiles are not retained. Online session storage discards staff names/email. Privacy receipts retain shop/topic/delivery/request identifiers and Shopify-supplied order lists; a keyed customer-routing hash is retained when supplied. These hashes and deletion markers remain sensitive metadata, not anonymous information. Missing protected data remains explicitly unavailable.

## Retention and deletion

Order snapshots, evaluations, exceptions and their history expire at the original order creation time plus30days; updates and decisions do not extend this limit. Order job routing expires within7days, shortened to the known order expiry. Current rule settings belong to the installation and are removed on uninstall. Uninstall disables ordinary jobs and clears stored sessions; privacy processing remains independent of Shopify credentials.

Authentic customer redaction deletes the supplied orders and derived records and invalidates prepared exports. Authentic shop redaction conservatively purges current tenant data, including an active/reinstalled tenant: its signed payload has no installation generation. A later verified installation can create new app state, but redacted order identifiers remain blocked.

Prepared exports expire within7days and no later than the earliest included order expiry. Completed redaction receipts have their plaintext order lists scrubbed, and are purged30days after completion. Completed data-request receipts qualify for the same purge only after a verified handoff is recorded in `deliveredAt`; undelivered requests remain visible for escalation even when their prepared export has expired. Unresolved/retried/failed requests also remain for operator escalation; this is not permission to ignore response deadlines. Physical cleanup depends on running workers; expiry also restricts reads/writes.

An independent authenticated deletion journal is flushed to disk before database deletion. Keyed shop/order hashes and deletion times have a current safety hold with no automatic expiration until backup/replay horizons are reviewed. This longer metadata retention needs owner review and documented justification; no legal retention exception is asserted.

## Access, protection and requests

Server checks isolate shops. Credentials, normalized orders, settings, evidence and prepared exports are application-encrypted. Routing metadata exists outside those encrypted values. Production database TLS, volume encryption, provider access, log retention and backup controls are **UNVERIFIED**. Worker logs omit payloads, tokens and routing identifiers; deployment/provider logs require separate assessment.

Shopify privacy webhooks authenticate original request bytes before receipt. A data request prepares a scoped export; processing completion does **not** mean delivery to the merchant. Authorized staff must arrange a verified, separately authorized handoff under the [support procedure](PRIVACY-SUPPORT.md), then explicitly record it with an encrypted actor/reason/time audit. Safe status counts distinguish awaiting handoff and overdue requests. There is no new public export endpoint, UI, automatic external delivery or policy publication. Contact and contractual arrangements remain unresolved.

Encrypted backups with a maximum7day horizon are a **proposal**, not an established provider commitment. Restore must remain offline, preserve the current independent journal, apply deletion/expiry and reconcile installation state before access resumes. Journal loss or rollback safeguards depend on unresolved hosting controls and block production readiness. This draft makes no claim of production PCD approval or platform subscription verification.
