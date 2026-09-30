# P09 platform requirements and registration evidence

Checked **2026-09-30**, America/Winnipeg. Official pages opened live; account configuration was not changed. This is technical research, not legal approval. Implementation/test results belong in [PRIVACY-EVIDENCE.md](PRIVACY-EVIDENCE.md).

## Official requirements

| Source | Applicable guidance |
|---|---|
| [Privacy law compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance) | App Store apps must subscribe to `customers/data_request`, `customers/redact`, `shop/redact`, even if they collect no personal data. Accept JSON POST; invalid HMAC requires401. Acknowledge valid receipt with2xx; finish requested action within30days. A documented legal obligation can prevent redaction; no such exception is established for this app. Data requests provide order IDs for delivery to the merchant; redaction supplies order IDs to erase. `shop/redact` is sent48hours after uninstall. Customer redaction timing is controlled by Shopify:10days if no order in six months, otherwise withheld until six months. CLI-triggered delivery does not test subscriptions. |
| [Verify webhook deliveries](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries) | HMAC-SHA256 uses the app client secret and original request body; compare the decoded signature before parsing/writing. Duplicate delivery is possible; idempotent processing or `X-Shopify-Webhook-Id` deduplication is required. The compliance-specific401 requirement takes priority over a generic example's400. |
| [Manage webhook subscriptions](https://shopify.dev/docs/apps/build/webhooks/subscribe) | App-specific TOML subscriptions are recommended. Compliance topics cannot be subscribed to through the Admin API. Config-managed subscriptions have no subscription ID; inspect Dev Dashboard→Versions→Configuration→Subscriptions. Logs distinguish Subscription Method. `webhookSubscriptions` queries cover shop-specific subscriptions and cannot alone prove compliance registration. App-specific failing subscriptions are not deleted; do not generalize deletion behavior from shop-specific subscriptions. |
| [App configuration](https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration) | `app dev` applies configuration to its chosen development store. Production configuration requires an app version release/deploy. A local TOML file alone is not proof that either environment received it. Relative webhook URIs are supported. No deploy/release is executed by this research. |
| [Troubleshoot webhooks](https://shopify.dev/docs/apps/build/webhooks/troubleshoot) | Respond within five seconds; defer processing. Failed deliveries can retry up to eight times over four hours. The project should acknowledge only after durable receipt and preserve failed privacy work independently of ordinary jobs. |
| [Protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data) | Orders and related webhooks are protected customer data without names/email. Development-store access follows saved selections, without review submission; production approval is separate. Name/Address/Email/Phone require separate approval. Level1 includes minimization, purpose disclosure, agreements, retention and encryption at rest/in transit. Level2 additionally lists encrypted backups and other controls. Do not attest that unknown hosting or agreements exist. |
| [Webhook reference, latest](https://shopify.dev/docs/api/webhooks/latest) | Page labels latest as2026-07. Compliance samples include `shop_id`, `shop_domain`, customer/order routing IDs and data-request ID. `X-Shopify-Webhook-Id` identifies a delivery; `X-Shopify-Event-Id` identifies the shared merchant action. Privacy payloads can contain email/phone; authentication does not authorize retaining them. |

## Reinstall and delayed shop redaction

The official [unstable webhook reference](https://shopify.dev/docs/api/webhooks/unstable) additionally states that development `shop/redact` emits no earlier than48hours and does not fire if the app has been reinstalled. This is supplemental **unstable** documentation, not proof that an already queued delivery can be ignored or a guarantee for the pinned2026-07 handler. The accessible latest2026-07 page supplies the payload but no installation generation.

Project inference: current `Shop.active`, an unsigned triggered-at header, or a new generation cannot authenticate the generation targeted by a delayed request. Do not silently discard an authentic redaction obligation. Use a documented conservative policy and synthetic delayed/reinstall tests; actual platform timing remains unverified.

Direct versioned `/api/webhooks/2026-07` and several2026-07 GraphQL reference URLs were unavailable through the documentation tool; they are not cited as verified. Existing pinned version is preserved, using the accessible latest page's explicit2026-07 label.

## Read-only local inspection

Inspected only allowlisted subscription/scopes/version lines from `shopify.app.toml` and ignored linked `shopify.app.local.toml`; no client IDs, URLs, secrets or store identity copied here.

Both files contain:

```toml
[access_scopes]
scopes = "read_orders"
[webhooks]
api_version = "2026-07"
[[webhooks.subscriptions]]
compliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]
uri = "/webhooks/privacy"
```

`app/routes/webhooks.privacy.tsx` dispatches these topics to the existing lifecycle handler. Its pre-P09 implementation durably records pending receipts; that is not proof of export, deletion, retention, restore safety or actual subscription registration. Root historical P02/P03 claims must be read against current STATUS and P09 evidence.

## Remaining platform/owner evidence

| Item | Current evidence | Required next evidence/action |
|---|---|---|
| Public distribution | Previously owner-confirmed saved selection | Preserve; no change requested. |
| Development PCD, no contact/address fields | Previously owner-confirmed saved Level1 selection; P03 live order evidence separately recorded | Preserve `read_orders`; no new personal fields or `read_all_orders`. |
| Compliance subscriptions on both development stores | Local TOML only in this task; no authenticated Dashboard/log read | **NOT RUN**. Read selected dev preview/configuration and config-managed subscriptions; actual signed delivery records must be distinguished from CLI samples. Do not repeat installs just to inspect this. |
| Production compliance registration | No released production version verified | **NOT RUN**. Before an authorized release, inspect active version's Configuration→Subscriptions and valid HTTPS destination; then verify real delivery/response evidence. Source publication does not deploy config. |
| Production PCD review | No production approval confirmed | **NOT RUN**. Reassess controls and owner statements; do not save questionnaire answers or submit review in P09. |
| Privacy notice, legal identity, support, hosting, backup provider | Unresolved | Draft only; obtain factual owner/provider details before publication or production commitments. |

P08 actual Shopify Admin workflow and in-app browser hydration issue, and P04 real update/cancel/multi-page checks remain open. This research neither repeats nor closes them.
