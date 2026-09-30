# Roadmap

The foundation and order-created ingestion are implemented. Recovery is the next slice. Each milestone needs its own executed evidence.

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


P05 is complete as contracts and fixtures only. Next is P06A value-rule implementation after explicit start; runtime rule evaluation remains unimplemented.


P06A reconciliation: only high_order_value is now implemented, preserving P05 semantics. Earlier no-rule statements describe prior milestones. See [implementation/evidence](P06A-HIGH-ORDER-VALUE.md); merchant settings/evaluation persistence remains absent, results are internal/transient. Next P06B; P04 live limitations remain.


P06B reconciliation (0.5.0): both accepted rules are implemented and tested, preserving contract 1.0.0. Earlier specification-only/quantity-unimplemented statements describe historical milestones. See [P06B evidence](P06B-LINE-QUANTITY.md). P07 local evaluator prerequisites pass; settings/results persistence and exceptions are still absent. Live P04 and production gates remain open.


P07 reconciliation (0.6.0): explicit shop settings, latest evaluations, stable exceptions and encrypted decision history now persist; earlier transient-only statements are historical. Terminal Resolve/Ignore decisions remain closed under automatic reevaluation. See [P07 lifecycle/evidence](P07-LIFECYCLE.md). P08 UI is next; no live migration/deployment or production-readiness claim.


P08 reconciliation (0.7.0): merchant onboarding/settings/inbox/detail/evidence and server-confirmed decisions now exist, with bounded API pagination and synthetic browser verification. Previous UI-unimplemented/unmigrated-dev statements are historical; existing dev data was preserved during the additive migration. No real thresholds were saved. See [P08 workflow and evidence](P08-MERCHANT-WORKFLOW.md). Real embedded Shopify acceptance remains NOT RUN; P09 is the next independent slice.


P09 reconciliation (0.8.0,2026-09-30): previous intake-only/unimplemented-privacy statements are historical. Scoped privacy processing, cascades, anti-replay/restore journal and retention are locally implemented/tested; actual compliance registration and production controls are NOT RUN/unresolved. Approved order allowlist,30dayoriginalcreatedAt expiry, monitoring boundaries and terminal decisions are unchanged. See [PRIVACY-EVIDENCE.md](PRIVACY-EVIDENCE.md), [policy draft](PRIVACY-POLICY.md) and [support](PRIVACY-SUPPORT.md). No separate financial/fulfillment status or new personal scopes added.
