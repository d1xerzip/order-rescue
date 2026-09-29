# Product scope

## Confirmed decisions
- Goal: Shopify App Store submission.
- Read Shopify orders and manage exceptions inside Order Rescue. Resolve and Ignore affect our records only.
- Enforce server-side shop isolation; protect credentials and customer data.
- No AI, customer messaging, refunds, cancellations or automatic order edits.

## Working baseline for this edition
Selected target hypothesis: a small physical-goods merchant whose owner/operator manually reviews unusually large order amounts or line quantities. No specific live merchant, country or validated demand is known. Launch decision: free first release; no billing integration, charge or paid tier. These are planning assumptions, not market-validation evidence.

One embedded Shopify Admin app with two merchant-configurable checks: `high_order_value` and `high_line_quantity`. One inbox, exception details with measured value/threshold/time, Open in Shopify, Resolve, Ignore, and settings. See [RULES.md](RULES.md) for precise semantics and synthetic acceptance cases.

Proposed journey: install → set and enable thresholds → receive a new order → see a rule match and evidence → inspect the order in Shopify → Resolve or Ignore in our app. Both rules start disabled until configured; no invented universal “safe” threshold.

Proposed screens: inbox with open/resolved/ignored filters and visible sync/coverage state; detail view; two-rule settings. Unavailable checks must be inspectable from a coverage warning, separate from matched exceptions. Loading, empty, disabled, access-denied and stale-sync states must differ. Empty inbox never claims all orders are safe. English merchant UI is a proposal; project explanations remain Russian.

## Coverage and limits — working defaults
- Monitor orders created at or after `monitoring_started_at` for the current installation. No pre-install historic import in V1.
- Keep at most 30 days of order-derived records measured from `Order.createdAt`; later edits do not extend expiry. Inbox states, jobs and evidence share that expiry.
- Recover missed events within that eligible window; show unrecoverable gaps explicitly. No promise of instantaneous detection or complete historic coverage.
- Use current snapshots and exact amounts in shop currency; no FX conversion. Cancelled orders are not actionable matches. Other fulfillment/payment filters are not part of V1.
- Rule changes apply on the next successful processing of an eligible order; no retrospective bulk reevaluation. UI explains this before saving.
- Alerts are review signals, not confirmed fraud, delivery failure or recovered revenue. No arbitrary severity score or savings claim.

## Not in release
AI, customer communications, Shopify order mutations, address validation, duplicate-order inference, country rules, inventory integrations, historical analytics, custom roles, bulk actions and speculative integrations. Paid billing is deferred because the selected first release is free. Adding a paid tier later requires its own product decision and verified platform setup.

## Product acceptance examples — NOT RUN
1. Shop A saves a CAD 1000 threshold; shop B's settings and inbox stay unchanged.
2. A complete eligible CAD 1000.01 order creates one value alert with evidence. CAD 1000.00 does not.
3. Resolve persists across reload while Shopify order data is unchanged; duplicate delivery does not reopen it.
4. Missing access shows “unable to check”, including the affected rule and last successful sync; not a success/empty state.
5. Open in Shopify uses the authenticated shop and stored order identity; a caller cannot navigate via a foreign tenant's record.


P05 specifies exactly two existing rules without implementing them; current authoritative cards are in P05-RULE-CONTRACT.md.
