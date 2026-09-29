# Development order-access proposal

No account setting or access approval is supplied with this source edition. For an App Store goal, propose Public distribution. Review the current official [distribution guidance](https://shopify.dev/docs/apps/launch/distribution/select-distribution-method) before selecting it; the selection cannot simply be switched afterward. Custom distribution is not a shortcut for unrelated merchants.

Proposed Dashboard path: app Home > Distribution > Select distribution method > Public distribution. Then API access requests > Protected customer data access > Request access: select Protected customer data and explain the order-review purpose. Leave Name, Address, Email and Phone unchecked. Preserve read_orders only; no read_all_orders or Direct API Access is needed by these rules. Account UI may differ from the documentation; verify actual labels before acting.

Orders are protected customer data. Development-only access configuration and production review are distinct: follow [current PCD guidance](https://shopify.dev/docs/apps/launch/protected-customer-data). Do not assert production approval or completed privacy controls from a successful dev query.

Purpose: compare current order totals in shop currency and individual current line quantities against merchant-configured thresholds; display evidence for manual review. Select only IDs, creation/update/cancellation timestamps, current shop-currency total and line IDs/quantities with pagination. No customer profile/contact data or mutation is needed. [Inventory](ARCHITECTURE.md).

The inert [scope query](p03/granted-scopes.graphql) and [order query](p03/order-access.graphql) target API 2026-07. After confirming applicable access, use the official server SDK and a known disposable synthetic order in each independently authorized dev store. Bind the request to its authenticated installation; fetch every line page and verify stable updatedAt including a final revision read. No raw values/IDs/tokens should enter public reports. Never publish live response bodies.

HTTP 200 with GraphQL errors, a null order, missing/redacted fields, missing/repeated cursor, changed revision or failed page is unavailable/incomplete, never a successful empty inbox. Validate response API version. Scope presence alone does not prove PCD access. Before persistent ingestion, implement current-scope/generation checks, minimal signed delivery handling, durable jobs, retry/dedup, retention and deletion-safe writes.
