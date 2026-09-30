# Current status — P09

Version **0.8.0**, branch `codex/p09-privacy-lifecycle`, 2026-09-30. Privacy implementation/synthetic checks complete; actual platform registration and production privacy readiness remain unverified.

## Changed
Original-byte privacy HMAC before writes, durable leased processing, scoped encrypted exports and separate confirmed-handoff audit; customer/shop deletion, persistent hashes and independent journal protect queued work/restore. Cascade covers evaluations/exceptions/history; sync checkpoint is reset. Staff session names/email are stripped. Retention and factual DRAFT policy/support procedure now match implementation. No new order fields/scopes or rule semantics.

## Verified
`npm test` **214/214 PASS**, including25 new privacy integration cases in a separate fresh synthetic PostgreSQL database. Invalid signature zero-write, DB outage503, large IDs, topic relabelling, tenant-scoped export/deletion, concurrent claims, UTC leases, retries/exhaustion, in-flight/completion races, uninstall/reinstall, journal crash/replay/restore and expiry verified. Typecheck/lint/build PASS; exact commands and evidence: [PRIVACY-EVIDENCE.md](PRIVACY-EVIDENCE.md).

## Not run / blockers
Existing dev database was not migrated for P09, privacy journal not provisioned there and privacy worker not started; no live deletion/restore. Review legacy pending synthetic receipts before starting that worker. Actual config-managed privacy subscriptions/delivery NOT RUN; local TOML is not registration proof. Production PCD, legal/support identity, secure export delivery, hosting/TLS/volume/log/backup controls and independently durable current journal remain unresolved. Prepared export is not delivered compliance. No account/questionnaire change, review, deployment or external message.

P08 actual Shopify Admin journey/App Bridge/Open in Shopify remains NOT RUN; in-app browser hydration issue unresolved. P04 real update/cancel and live multi-page checks remain NOT RUN. Installation tests not repeated. Source publication is not deployment.

## Next
P10A first close the P08 in-app hydration defect using the synthetic harness, then prepare preserved-data dev schema/journal startup and inspect actual privacy subscription registration read-only. Do not process legacy privacy fixtures or delete live data without reviewed provenance. Keep owner/provider/privacy gates explicit before candidate deployment.
