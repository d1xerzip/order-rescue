# Current status — dependency decision / open release gates

Version **0.8.3**, codex/dependency-remediation-plan, 2026-09-30. Baseline public v0.8.2 at 2187d87f6837bb06e17413dee08a588bff4e8c7f. Documentation/evidence patch only; application, schema, dependency versions and business semantics unchanged.

## Changed
Prepared [supported dependency decision and conditional migration proposal](DEPENDENCY-REMEDIATION.md), with installed/published peer ranges, exact acceptance and rollback requirements. No forced major override, ORM rewrite or account change.

## Verified
Current npm metadata: newest6.x is Prisma6.19.3; latest Shopify adapter11.0.0 still requires Prisma6; latest @prisma/config7.10.0 still pins deepmerge7.1.5. Registry Prisma latest is8.0.0-rc.19, not a verified stable fix. Installed dependency graph valid. Production audit still exits1 with4high. Application/test/schema/script source matches v0.8.2; package changes only release version. Independent research findings verified against official sources and registry metadata. [Evidence](evidence/dependencies/review.json).

## Not run / blockers
No new runtime tests/build/load/restore/browser runs: no behavior changed. v0.8.2 evidence remains233 tests PASS and the bounded synthetic load/actual restore PASS; those are previous-run results, not new0.8.3 tests. Dependency advisory remains OPEN: no supported drop-in fix found.

P08 actual Shopify Admin/App Bridge/actions/settings/order link/embedded Console and P04 remaining real update/cancel/multipage checks remain NOT RUN. Browser refusal has not been retested without an owner-side change; no workaround. Local P10A hydration repair does not establish current Shopify hydration.

P09 existing-dev migration/journal/worker and pending receipt provenance remain unapplied; actual privacy subscription/delivery NOT RUN. Production PCD, legal/support identity, secure export handoff, provider/TLS/volume/log/backup controls and independently durable current journal remain open. No real deletion/restore. SDK token-refresh timeout, realistic pilot capacity and provider/full deployment rollback still need evidence.

## Decision / next
**NOT READY for real pilot, production or App Store submission.** No security waiver or full P10 acceptance. The dependency proposal is complete; a supported fix remains gated on compatible upstream releases. Next independent task: actual local background-auth HTTP timeout/cancellation check in [NEXT.md](NEXT.md). Source publication is not deployment.
