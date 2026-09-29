# Roadmap

Only the foundation is implemented. Each milestone needs its own executed evidence.

| Milestone | Dependency | Acceptance |
|---|---|---|
| Development access | Authorized app/stores, minimal scope and PCD configuration | Minimal synthetic order read independently succeeds in both stores; errors are not empty success |
| Ingestion | Access and privacy/data design | Signed event durably queued; invalid signature/DB failure not acknowledged as durable success; retry/concurrent/crash delivery has one effect |
| Recovery | Ingestion | Eligible missed orders recovered; stale events cannot overwrite current data; cursor advances only after persistence |
| Rules | Complete eligible snapshots | Exact decimal value and per-line quantity examples in RULES.md pass; unavailable remains unknown |
| Exceptions | Rules | One tenant-scoped identity; Resolve/Ignore persist without Shopify mutation or automatic reopening |
| UI | Exceptions | Settings, inbox/evidence, Shopify link, clear empty/unavailable/stale states |
| Privacy | All data paths | Complete export/redaction/TTL, deletion-safe retries and restore, factual disclosures |
| Release | Functional/reliability/privacy evidence, production access | Separately authorized hosting/deployment, review-ready listing, then submission and approval |

Free first release. AI, customer messaging, order mutations, address validation and speculative integrations are deferred. This roadmap authorizes no external action.
