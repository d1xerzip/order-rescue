# P04 — bounded synchronization

Version **0.2.0**. GraphQL Admin API pinned to **2026-07**. No new scopes, personal fields, rules, UI or Shopify mutations.

## Window and data contract

`read_orders` normally permits the most recent 60 days. This app deliberately reads only orders created at or after `max(current installation timestamp, now - 30 days)`. It does not promise all historical orders. Snapshots expire at creation plus 30 days; routing jobs at receipt plus seven days or earlier snapshot expiry. Installation generations remain isolated.

Approved fields are order GID/legacy ID, createdAt/updatedAt, cancelledAt, current shop-money amount/currency, line GID/currentQuantity. Monetary strings remain exact. Missing fields are unavailable, not empty. Null cancellation is known-not-cancelled. `currentQuantity` excludes removed/refunded units, not fulfilled units; partial fulfillment does not lower this rule input. Customer names, email, phone, addresses, customer ID, product titles, payment and fulfillment fields are not selected.

## Events, stale state and transactions

`orders/create`, `orders/updated` and `orders/cancelled` share original-byte HMAC verification and durable intake. Only routing IDs are retained after verification. Payload state never overwrites snapshots. Delivery deduplication is `(shopId, generation, X-Shopify-Webhook-Id)`; snapshot identity is `(shopId, generation, orderId)`.

Webhook and reconciliation jobs acquire the same durable per-order read lease before authenticated API reads. Two complete normalized snapshots must match; equal updatedAt alone is not revision proof. Line order is normalized by ID. Stabilization stops after three attempts. A later stable authoritative read may repair different fields at an equal timestamp; an older timestamp cannot overwrite persisted state. This is bounded observed stability, not an atomic Shopify snapshot or protection from every upstream replica lag. Periodic rereads converge after upstream state stabilizes.

Network reads occur outside transactions. A short snapshot transaction locks lifecycle, shop, job and read lease, validates the active generation, privacy guard, current claim and discovery minimum revision, then persists the encrypted snapshot. Completion is separately fenced, preserving crash replay. Expired read locks are purged.

## Discovery and recovery

The first worker pass starts initial synchronization. Subsequent passes start five minutes after a successful pass. Each pass rescans the **entire eligible window** with fixed inclusive bounds. Full overlap avoids assuming unique timestamps or a fixed search-index delay. Later passes recover delayed visibility while an order remains eligible; nothing promises recovery after retention expiry.

Discovery uses `orders(first: 50, after, sortKey: CREATED_AT)` and quoted inclusive created_at filters. Search bounds broaden to seconds, then exact bounds are checked locally while retaining server pageInfo. Page jobs and a pending cursor are committed together. Cursor advancement waits for all page jobs to finish and for retained snapshots to have the approved fields available and meet the discovered revision. Interrupted fetches retain the previous checkpoint; replays reuse deterministic job identifiers. The 500-page ceiling fails visibly rather than claiming complete coverage.

HTTP errors, malformed responses, version mismatch and GraphQL errors/partial responses fail even when HTTP status is 200. SDK-wrapped headers are supported. Cost/throttle metadata, Retry-After and exponential backoff control retries. Transport tries at most three times before durable deferral; pages retry at most three times and order jobs at most five. Long page throttles over one hour require operator attention. Multiple workers share database claims; cost pacing is per process.

## Runbook

1. Follow [local setup](LOCAL-SETUP.md), configure a separately authorized development registration and apply this edition's migrations with the documented command. The synchronization migration follows the foundation and ingestion migrations. Do not apply a renamed public migration history to an existing private deployment.
2. Start `npm run worker:orders` with the current app URL and required environment configuration. Preserve database state across process restarts.
3. `GET /api/sync` authenticates server-side and derives the shop from the verified session. It returns phase, last successful synchronization, next run, backlog, failed count and safe error codes. It exposes no customer payload, order IDs or cursor.
4. For a failed pass, fix access, API or field availability first. Trusted local operator code can call `resetOrderSync` for the internal shop to restart the bounded policy. An order expiring during a long pass currently requires this reset; incomplete coverage is not reported as successful.
5. Disabled or uninstalled generations cannot claim ordinary jobs. Required privacy intake remains separate; complete deletion/export/restore is unfinished release work.

## Evidence and limits

42 relevant synthetic tests passed across targeted runs: snapshot 9, discovery 5, transport 8, ingestion 10, sync 6 and updates 4. Tests cover missing events, reversed delivery, equal revisions, races, interrupted/replayed pages, throttling, cancellation and partial fulfillment. Typecheck, lint and build passed. An initial update fixture used an invalid earlier clock; the fixture was corrected and its four tests then passed.

Actual GraphQL synchronization ran in two development stores, with one discovered order in each. Order IDs and approved fields matched an independent API reread. These checks were not substituted with fixture webhooks. Actual update/cancellation webhook delivery and multi-page live synchronization remain **NOT RUN**. The public edition excludes live identities and operational receipts and is not connected to those stores.

## Official sources

- [Order access and timestamps](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order)
- [Order discovery](https://shopify.dev/docs/api/admin-graphql/latest/queries/orders), [search syntax](https://shopify.dev/docs/api/usage/search-syntax), [pagination](https://shopify.dev/docs/api/usage/pagination-graphql)
- [LineItem currentQuantity](https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItem)
- [Webhook topics](https://shopify.dev/docs/api/admin-graphql/latest/enums/WebhookSubscriptionTopic), [API versioning](https://shopify.dev/docs/api/usage/versioning)
- [Cost throttling](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits), [API limits](https://shopify.dev/docs/api/usage/limits), [GraphQL errors](https://shopify.dev/docs/api/admin-graphql/latest#status-and-error-codes)

The source review identified 2026-07 as the current supported selector. The implementation pins that version and verifies returned version headers. Recheck time-sensitive documentation before future platform changes.
