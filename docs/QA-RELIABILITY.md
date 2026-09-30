# P10B — local operational reliability

2026-09-30. Candidate **0.8.2**, branch `codex/p10b-local-reliability`, baseline public `v0.8.1` at `3fc5bf98978a7f99b5b633a4a44ea333c89ff353`. This is an independent local patch/evidence slice, not completion of the full P10 release gate. Application rules, explicit merchant thresholds, inventory, retention and monitoring boundaries are unchanged; no schema migration was added.

## Decision and evidence scope

**PASS for the proposed bounded synthetic queue/recovery envelope below. NOT READY for an actual merchant pilot, production deployment or App Store submission.** Local reliability does not close the [P10A functional gates](QA-FUNCTIONAL.md), actual Shopify workflow, privacy registrations or provider controls. The unresolved production dependency advisory also remains a release blocker.

The executed source is bound by normalized per-file hashes in [load evidence](evidence/p10b/load.json) and [restore evidence](evidence/p10b/restore.json). Each runner asserts the candidate source remains unchanged during its run. The sanitized release commit/tag and `SOURCE-MANIFEST.json` bind the published copy; runtime/test source equality is checked before staging. No screenshot or build is substituted for delivery or recovery evidence.

Browser retry: **Codex In-app Browser (`iab`), `mcp__cua_repl`** rejected both `admin.shopify.com` and `dev.shopify.com` with: “Browser Use rejected this action due to browser security policy. Reason: A saved user permission setting blocks this action.” It also prohibited indirect/raw-CDP/alternate-browser workarounds. No workaround was attempted, no Shopify account page was inspected, and no account/questionnaire answer changed. This was a fresh access attempt, not a claim of a Codex restart or real Shopify acceptance. Passed installation checks were not repeated.

## Predetermined envelope and environment

Confirmed pilot merchant/order volume is **UNKNOWN**. The product hypothesis concerns small physical-goods merchants; it supplies no capacity commitment. [p10b-envelope.json](fixtures/p10b-envelope.json) records a **proposal** before execution: three fictional shops, one worker, 60 seconds at one new order/second followed by 120 orders in a burst, every fifth delivery duplicated, six simultaneous HTTP submissions, up to three lines/order and injected GraphQL latency20ms per request. Both settings are explicitly CAD100.00 and quantity5, solely synthetic examples.

Windows x64, Node22.18.0, npm10.9.3, embedded PostgreSQL18.4, Prisma6.19.3. No host username/path is part of public evidence. The load runner creates a new private cluster on loopback55434 and `rescue_reliability_<timestamp>`; restore uses a different cluster55435 with distinct source and target databases. Random credentials and independent journal paths are generated without loading `.env.local`; existing dev55432 and ordinary test55433 are not load/restore targets. Ports must be free. All runner clusters stop in `finally`; private synthetic journals/dumps remain outside publication for investigation. No live deletion or restore occurred.

The HTTP workload uses the actual original-byte HMAC handler, durable PostgreSQL queue, worker claiming, normal snapshot GraphQL parsing, snapshot/evaluation/exception transactions and encrypted reads. Upstream GraphQL is injected, not Shopify. The timed worker loop calls the existing job function; the complete CLI discovery scheduler is **not** measured. A separate fault test executes reconciliation pages/checkpoints.

Before executing, the generator fixes expected outcomes independently: serial numbers divisible by3 have CAD100.00 and per-line quantity3 (both not_matched); all others have CAD100.01 and quantity6 (both matched). Exact `(shopId, generation, orderId)` snapshot sets, decrypted fields, both rule identities/outcomes/reasons/versions and each expected open exception with one observation are asserted, not inferred from counts. The crashed no-match order is additional to the180 normal profile orders. Separate regression coverage exercises matched orders crashing five times.

## Measured results

Final run 2026-09-30T07:44:20.813Z to 2026-09-30T07:45:45.684Z; timed profile **81300ms**, including 60000ms steady input and 709ms burst submission.

| Measurement | Proposed target | Observed | Status |
|---|---|---|---|
| Healthy receipt errors |0|0/216 (0%)|PASS|
| Worker unexpected errors / duplicate effects |0|0 /0|PASS|
| Receipt p95 / maximum |1000 /5000ms|42 /72ms|PASS|
| Processing p95 / maximum |p95<=30000ms|19041 /20590ms|PASS|
| Oldest pending/retry sample |<=45000ms|20349ms|PASS|
| Drain after last receipt |<=60000ms|20590ms|PASS|
| Quiet-shop p95 |each<=30000ms|18544 /20590ms|PASS|
| Full restored records/history equality |true|true,9 tables|PASS|
| Deleted record resurrection after restore |false|false; journal preserved|PASS|

Maximum sampled backlog **117**, peak sampled load-process RSS **118MiB**. Shops completed 144/18/18 profile orders; busy-shop p95 15329ms. Transport made905 injected GraphQL calls including crash recovery. Actual stopped-DB receipt returned503 in1020ms with no durable job. No real Shopify requests were part of this load.

Processing latency is receipt timestamp to observed completion, excluding the deliberately crashed processing lease from normal profile percentiles. Oldest pending samples pending/retry rows every100ms; it is not the maximum age of every unfinished job. Deliberate401/503 fault responses are outside the healthy-load error denominator. Node RSS excludes PostgreSQL, child process and host total; CPU/disk/provider limits were not benchmarked. One bounded run is not a sustained production capacity estimate.

## Criterion-to-evidence matrix

| Criterion | Status | Observed evidence and boundary |
|---|---|---|
| Authentic durable receipt and invalid HMAC | PASS local | Actual HTTP original-byte signature route;216 profile receipts, invalid signature401 with zero new jobs |
| Duplicate delivery and exact tenant/rule effects | PASS local |36 repeats; exact scoped snapshot/evaluation/exception identities and full snapshot fields asserted; no extra histories |
| Out-of-order delivery | PASS local | Newer exact250.00 snapshot retained after older API snapshot; existing equal-timestamp/race tests also pass in full suite |
| Process death after persistence | PASS local, real process | Child exits73 after committed snapshot but before completion; real60s configured lease expires; attempt2 completes with unchanged effects. Lease duration is configuration, not measured recovery latency |
| Exhausted crashed leases | PASS local, virtual clock | Five matched-order post-write crash seams; sweeper makes `ATTEMPTS_EXHAUSTED` visible; no sixth claim, one snapshot/two exceptions/two observations |
| Missing event/interrupted page/checkpoint | PASS local | Two missed orders recovered across interrupted second page; saved cursor survives retry, exact fields checked, sync returns idle |
| Unavailable database | PASS local, real process | Only disposable PostgreSQL stopped; signed HTTP receipt503, zero accepted jobs; restart and reconnect recover |
| API timeout/throttling | PASS adapter test | Injected TimeoutError then HTTP429 Retry-After2 then success; three attempts, virtual waits1000/2000ms. Not a real stalled socket or SDK refresh timeout test |
| HTTP200 GraphQL partial/error | PASS local | Partial data with errors rejected; no successful snapshot inferred from HTTP200 |
| Delay and bounded retries | PASS local | Future availableAt cannot claim early; backlog remains visible; fifth recoverable failure becomes observable failed job |
| Excessive throttle hint | PASS regression | Up to1h honored; above1h fails with `THROTTLE_DELAY_EXCESSIVE`, not an indefinite hidden delay or early retry |
| Uninstall with queued work | PASS local | Ordinary worker performs zero upstream reads; sweep marks queued work INACTIVE_INSTALLATION. Privacy path tests remain in full suite |
| Backup/actual distinct restore | PASS local | Custom-format pg_dump/pg_restore; all rows/columns of nine tables compared, including settings, exception decisions/history; see [restore rehearsal](P10B-RESTORE.md) |
| Post-backup deletion protections | PASS local | Current independent journal blocks restored stale rows before sweep; queued work cannot fetch erased order; foreign shop with same ID retained |
| Application rollback with current schema | PASS bounded source rehearsal | Archivedv0.8.1 server modules read/write current schema/settings/history/worker and enforce deletion guards using current dependencies; full binary/container/browser rollback NOT RUN |
| Current Shopify workflow/registration | NOT RUN | Browser refusal, retained P08–P10A gates; no live capacity, authentication or compliance-delivery claim |
| Provider backup/production TLS/volume controls | NOT RUN | Local dump restore is not evidence of deployed backups, backup encryption, RTO/RPO or journal external durability |

## Repairs and operational limits

Order jobs previously accepted an unbounded retry hint while discovery already capped it. The current fix preserves hints up to one hour and makes larger hints a visible terminal error requiring operator investigation. Five attempts,60s claims, exponential retry bounds and fenced writes remain in place. This is not a new auto-retry endpoint or new product feature.

Global order claiming is FIFO by `availableAt,id`; there is no hard per-shop fair share or tenant quota. The burst deliberately puts96 busy-shop orders ahead of each quiet shop's12. Quiet-shop latency below the proposed30s target supports only this sample. A busy shop can delay other shops in a larger load. Discovery round-robin and API pacing are process-local. Concurrent worker/provider quotas require separate validation. The runner DB pool limit is4; it is not a recommended hosting limit.

GraphQL uses up to three bounded transport attempts, configured cost/throttle handling and a pinned API version. Large orders may require up to100 line pages for each stable read plus rereads/retries; that can outlast a60s lease. Fencing protects state but does not establish completion capacity. The runtime10s Admin API abort applies after background authentication; SDK token refresh cancellation is **NOT RUN** and the auth-lock transaction timeout is not proof that underlying HTTP is cancelled. No guarantee of all possible network hangs recovering is made.

Backup:45,030 bytes; dump368ms; restore289ms; full rehearsal12,885ms. These measured values are not production RTO/RPO. The backup precedes a synthetic deletion, and restore uses the current separately preserved journal/key. Archivedv0.8.1 runs current schema with current installed dependencies. Do not down-migrate destructively: use a compatible forward fix or isolated compatible restore, apply current deletion decisions before opening access, and reverify. Provider backup scheduling/retention, encrypted dump volume and independent external journal custody remain unverified.

## Commands actually executed and failures

| Command | Result |
|---|---|
| `npm pkg set 'overrides.vite.esbuild=0.28.2'` | Failed EWORKSPACESINVALID against inherited workspace-object syntax; no workspace rewrite. Scoped override then edited directly |
| `npm install --no-audit --no-fund` | PASS, lockfile updated |
| `npm ls esbuild --omit=dev` | PASS; Vite resolves0.28.2, as does tsx |
| `npm test -- tests/order-reliability.test.ts` |2/2 PASS, new bounded-hint and fifth-crash regression coverage |
| `node scripts/reliability-load.mjs` | Initial timing run PASS; independent review found missing per-record tenant/outcome assertions and source binding. Final strengthened run is the evidence linked above; no production behavior changed for this rerun |
| `node scripts/reliability-restore.mjs` | Initial client-tool lookup failed ENOENT before backup. Portable official tools supplied; actual final source/target restore PASS, repro/hash-binding fixes included |
| `npm run db:generate` | PASS; generation only, no existing-dev migration |
| `npm test` |233/233 PASS,0 failed/skipped/cancelled; fresh disposable synthetic DB |
| `npm run typecheck`; `npm run lint`; `npm run build` | PASS on candidate; typecheck/lint repeated after strengthened load assertions. Initial new-harness empty-array typing failure fixed, not suppressed |
| `npm audit --omit=dev --json` | Exit1:4 high entries, one underlying Prisma/deepmerge advisory; **not clean** |

Private logs and dumps are excluded from the source release. Machine-readable sanitized reports contain assertions, measurements and fingerprints, not raw customer payloads, auth tokens or machine identity. Restore commands/tool prerequisites and exact comparison tables are in [P10B-RESTORE.md](P10B-RESTORE.md).

## Current sources and dependency decision

Official sources opened2026-09-30: [Shopify webhook troubleshooting](https://shopify.dev/docs/apps/build/webhooks/troubleshoot) documents the short receipt deadline and retries; [Shopify API limits](https://shopify.dev/docs/api/usage/limits) documents cost/throttle handling. The observed local receipt times are compared with our proposed stricter p95 target and5s maximum; injected transport does not prove actual Shopify rate-limit behavior. [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html) and [portable tooling provenance](P10B-RESTORE.md) support the actual restore method.

The scoped Vite esbuild0.28.2 override is within [Vite7.3.6's declared range](https://raw.githubusercontent.com/vitejs/vite/v7.3.6/packages/vite/package.json) and fixes [GHSA-g7r4-m6w7-qqqr](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr) for that production graph. Shopify CLI3's own0.27.4 pin remains a development-only advisory; no unverified CLI major override is applied.

Production audit drops from5 entries(4high/1low) to4high, all propagated from [deepmerge-ts GHSA-ggr8-5vv4-36mx](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx) via Prisma configuration. The installed Prisma6 config pins7.1.5; the session adapter supports Prisma6.19. An incompatible deepmerge8 or Prisma major replacement was not forced. No exposed cyclic JavaScript config merge was found in current app routes; this bounded reachability observation does not waive the advisory. A supported dependency migration/replacement and its regression evidence remain required before release approval.

## Retained gates / next step

Preserve P08 actual Admin/App Bridge/evidence/actions/settings/Open in Shopify and embedded Console, P04 actual update/cancel/multipage recovery, and P09 actual compliance registration/delivery. Local P10A hydration repair does not establish current Shopify hydration. Existing-dev schema/journal/worker are still not migrated/provisioned; pending legacy synthetic receipts require provenance review and synthetic-only deletion authority does not permit stripping existing dev data. Production PCD, legal/support identity, secure export handoff, provider/TLS/volume/log/backup decisions and independent journal custody remain unresolved.

The independent local P10B slice is complete for this envelope. Full P10A/P10B acceptance is open. Next is the smallest unblocked release-gate task in [NEXT.md](NEXT.md); do not infer authorization to deploy, submit, alter questionnaire answers or delete development-store data.

## Follow-up0.8.4 — token-refresh gap now has observed FAIL

The earlier injected TimeoutError PASS covered the API wrapper only. [Real loopback SDK refresh](AUTH-TIMEOUT-DIAGNOSTIC.md) remains pending beyond65s and can recreate encrypted session credentials after auth-lock expiry/uninstall; final promise rejectsP2028. This new release blocker supersedes the previous NOT RUN for that specific case. Earlier bounded load/restore results remain historical, not acceptance of the untested stall. Body stalls, privacy-erasure and reinstall-generation variants still need coverage.
