# Order-created ingestion

The read-only orders/create slice uses the existing PostgreSQL database as a durable queue. Raw request bytes authenticate with HMAC before parsing or database access. Intake stores only routing identifiers, commits before HTTP 200, and returns non-success for invalid signatures or unavailable storage. Raw payloads are not persisted or logged.

## Transactions and recovery

Delivery dedup uses X-Shopify-Webhook-Id with shop/installation generation. A separate worker atomically claims jobs with SKIP LOCKED, a 60-second fenced lease and five attempts. States are pending, processing, retry, completed and failed. Retry delays double from 60 seconds, capped at 15 minutes. Snapshot writes take installation/job locks and recheck active generation, scope state, lease and pending redaction. Separate job completion allows crash-after-write replay without duplicate snapshots. Unique shop/generation/order identity and revision comparison prevent duplicate effects and stale overwrites.

Headers are routing hints, not HMAC-bound tenant identity. The worker uses that installation's official SDK credential, verifies shop identity/current scopes, then fetches the order. Foreign or inaccessible orders never become snapshots. API version 2026-07 is checked from HTTP headers or the SDK's wrapped body.headers; missing/mismatched versions fail.

Only approved IDs, timestamps, exact decimal money/currency and current line quantities are normalized. All line pages and a final revision check must agree. Unavailable fields remain explicit; empty lists and null cancellation are known values. No title, customer contacts or paid-status field is selected. AES-256-GCM snapshots bind shop/generation/order through AAD. Routing metadata still requires infrastructure encryption for production.

Orders expire at creation+30 days; jobs at receipt+7 days, shortened to order expiry when known. Maintenance requires a running worker. Pending redaction blocks new writes, but full export/deletion/backup restore remains incomplete. No rules, inbox or historic backfill.

## Setup

Confirm owner-authorized public distribution and saved development Protected Customer Data category; no identifying fields or read_all_orders. Apply the additive migration to the intended local database after review. Apply docs/p03/orders-create.subscription.toml to the linked development configuration. Enable ORDER_INGESTION_ENABLED=1 privately. Start the app using the existing setup; in a separate PowerShell terminal set $env:SHOPIFY_APP_URL to the current CLI HTTPS URL, then run npm run worker:orders. Do not pin a stale tunnel URL in shared .env.local when CLI manages it. Preserve SESSION_ENCRYPTION_KEY.

Run targeted synthetic checks with npm test -- tests/order-ingestion.test.ts tests/order-snapshot.test.ts. The status helper takes explicit dev-store domains and a loopback database; it prints counts only and does not claim counts prove live origin. Genuine integration requires a newly created synthetic dev-store order, actual authenticated delivery and a matching persisted snapshot; fixture replay alone is insufficient.

## Official references

References reviewed during implementation: [verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries), [payload selection](https://shopify.dev/docs/apps/build/webhooks/delivery-structure), [configuration](https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration), [protected data](https://shopify.dev/docs/apps/launch/protected-customer-data), [SDK wrapper](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-app-react-router/src/server/clients/admin/graphql.ts). Recheck current guidance before platform changes.
