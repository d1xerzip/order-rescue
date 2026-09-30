# Current status — P10B local reliability / open release gates

Version **0.8.2**, branch codex/p10b-local-reliability, 2026-09-30. Baseline public v0.8.1 at 3fc5bf98978a7f99b5b633a4a44ea333c89ff353. Local reliability patch/evidence complete; full P10A/P10B acceptance remains open. The source release manifest and per-run source hashes bind the tested candidate.

## Changed
Bound excessive order retry hints to a visible THROTTLE_DELAY_EXCESSIVE failure; add exhausted-crash regression coverage. Update only Vite's compatible esbuild override to0.28.2. Add isolated synthetic load/fault, actual backup/restore and baseline-source rollback rehearsals. Rules, fields, retention, thresholds and schema unchanged.

## Verified
233/233 tests PASS; Prisma generation/typecheck/lint/build PASS. Load:180 orders +36 repeated receipts across3 fictional shops; exact tenant/order/rule identities, fields and histories checked. Receipt p95 42ms; processing p95 19041ms; oldest pending 20349ms; drain 20590ms;0 unexpected receipt/worker errors. Real disposable DB outage and worker-process death recover. Actual pg_dump/pg_restore into a different disposable DB compares9 tables; preserved independent journal blocks post-backup erasure resurrection. Archivedv0.8.1 server source works with current schema/current dependencies. [Evidence, exact commands, environment and limits](QA-RELIABILITY.md).

## Not run / blockers
Both Shopify domains again refused by Codex In-app Browser saved-permission policy; no workaround. P08 actual Admin/App Bridge/workflow/order link/embedded Console and P04 remaining live update/cancel/multipage checks stay NOT RUN. Local P10A hydration repair is not actual Shopify evidence; passed install checks not repeated.

P09 existing-dev migration/journal/worker and legacy synthetic receipt provenance remain pending. Actual privacy subscriptions/delivery NOT RUN. Production PCD, legal/support identity, secure export handoff, provider/TLS/volume/log/backups and externally durable current privacy journal remain unresolved. No live deletion/restore or account/questionnaire change.

Production audit exit1:4high entries from Prisma/deepmerge remain; Vite production esbuild advisory fixed. Dev CLI esbuild advisory remains. Real stalled SDK-token-refresh cancellation, large-line/high-concurrency capacity, provider restore and full binary/container rollback NOT RUN. FIFO is not a per-shop fairness guarantee.

## Decision / next
**PASS only for the recorded synthetic envelope; NOT READY for a real pilot, production or App Store submission.** No confirmed merchant volume. Full P10 remains open, so this source-save is a patch, not a completed-minor milestone. Next: supported dependency remediation and preserved external evidence gates in [NEXT.md](NEXT.md). Source publication is not deployment.
