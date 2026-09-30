# Background authentication timeout — diagnostic, not a security fix

2026-09-30; release0.8.4 on `codex/auth-timeout-diagnostic`, baseline `v0.8.3` / `3fc699d481ac63c5450e33537097bd4cea73e021`. Application, schema, installed dependency versions and managed authentication flow are unchanged. Only the reproducible diagnostic, evidence and release documentation were added.

## Relationship to the advisory

**There is no direct remediation relationship.** GHSA-ggr8-5vv4-36mx concerns recursive JavaScript object graphs in deepmerge-ts, reached through the Prisma configuration dependency. The HTTP experiment neither exercises nor patches that library. The [dependency decision](DEPENDENCY-REMEDIATION.md) and its4high audit findings remain open; a timeout cannot turn that advisory into PASS or establish that it is unreachable.

The experiment instead closes an evidence gap identified by [P10B](QA-RELIABILITY.md): its injected TimeoutError did not prove that a real stalled Shopify token refresh is cancelled. A network deadline and a database transaction timeout protect different resources. Their interaction matters because the SDK can persist a refreshed token after the network response.

## Predetermined experiment and isolation

The diagnostic fixes proposed acceptance before running: refresh should settle/cancel within15s (a proposed bound, not a Shopify promise), no credential write after uninstall, and no ordinary access after uninstall. It records observations at16s and65s to distinguish this bound from the existing60s Prisma auth transaction. An95s test-only cleanup watchdog prevents the fixture from hanging indefinitely; it is not application cancellation.

Run after locked dependencies and Prisma generation are available:

```powershell
node scripts/auth-timeout-check.mjs
```

The runner creates a new isolated PostgreSQL cluster on127.0.0.1:55436, a unique `rescue_auth_timeout_*` database, random synthetic keys and an independent private journal. It never reads `.env.local`, accepts a live database URL, changes accounts, or uses an existing dev database. Both application and auth-lock pools have one connection, matching the established synthetic auth-concurrency profile. PostgreSQL and the HTTP server stop after the check; synthetic private files remain outside publication.

The official installed Shopify SDK13.1.0 creates the OAuth refresh request and parses/saves the response. Its supported abstract-fetch test hook forwards only two allowlisted fictional shop endpoints to an owned HTTP server on a random loopback port. Everything else is rejected before any outbound fetch. This preserves real HTTP sockets and SDK execution, but does **not** verify Shopify DNS/TLS/server behavior. Raw request bodies, tokens, passwords and customer payloads are not logged or included in evidence.

Steps:

1. Seed two synthetic active shops with encrypted expired offline sessions; normal shopB refresh returns after200ms. Verify rotation and encrypted persistence.
2. Start shopA background auth; local server receives the refresh request and sends no headers/body. Observe the promise and socket at16s, then65s, without an injected error or accelerated clock.
3. After65s send an authentic synthetic uninstall through the actual handler. Confirm sessions removed and ordinary jobs disabled. Accept a synthetic privacy data-request receipt independently of offline authentication; no export/deletion worker is run.
4. Manually release the previously held HTTP response. Observe final auth failure/success and whether the SDK writes a session after uninstall. Recheck ordinary access and healthy shopB recovery.

## Observed result

Final run 2026-09-30T08:48:13.381Z to 2026-09-30T08:49:18.840Z. **Operational acceptance: FAIL; diagnostic completed.**

| Observation | Result |
|---|---|
| Normal delayed refresh and encrypted storage |292ms, verified |
| Refresh pending / socket open at16s |true /true |
| Refresh pending / socket open at65s |true /true |
| SDK-supplied abort signals / observed aborted sockets |0 /0 |
| Uninstall after old transaction expiry |200 in16ms; session rows0 before late reply |
| Late response recreated encrypted session |**true — FAIL** |
| Final background-auth outcome |P2028; completion after manual reply at65038ms from request start |
| Subsequent ordinary access for uninstalled shop |Denied |
| Privacy intake after uninstall |HTTP200; processing not claimed |
| Subsequent healthy shopB auth |9ms, reuse of its already-rotated session; no second HTTP refresh |

The diagnostic finishes successfully when observations and invariants have been recorded. Its process exit0 **does not mean operational acceptance**: the JSON explicitly records `acceptance: FAIL` and `advisoryRemediated: false`. Source fingerprints before/after the run bind the relevant application/lockfile/runner files. See [machine-readable evidence](evidence/auth-timeout/result.json).

## What is proved and what is not

**Proved locally:** the current SDK refresh received no application AbortSignal; the real HTTP request and auth promise remained pending beyond the60s transaction lifetime. Successful uninstall before the held response demonstrates that the old database lock no longer serialized that operation. The late SDK response physically recreated an encrypted session after uninstall; the auth promise then failed with PrismaP2028. Encryption protected the value at rest but did not prevent the invalid late write. Ordinary `authenticatedBackground` remained denied by inactive-shop checks, and privacy intake remained available.

This is an observed local lifecycle defect, not proof of successful unauthorized Shopify access, token usefulness after actual Shopify revocation, or an exploit against a real merchant. Shop-redact processing, reinstall-generation races, DNS/TLS/proxy stalls and incomplete-response-body stalls were not exercised. No claim is made that the request would never time out on its own: it was still pending at65s and the test manually supplied a response then. The test did not wait for transport defaults over several minutes.

Measurement caveats: the15s proposal was sampled at16s, so this run proves a failure well beyond that bound, not precise boundary compliance. A future repair must record exact settlement time; the current sampling cannot distinguish15.0s from15.5s. The evidence field `elapsedUntilManualLateReplyMs` records completion after the reply and includes subsequent SDK/database work; it is not the precise server reply timestamp. ShopB's later call reuses its already-valid token; fresh refresh recovery after cancellation remains untested.

## Possible correction and temporary limitation

**Proposed fix, not implemented in this diagnostic:**

- Bound the SDK OAuth transport using the documented `setAbstractFetchFunc` runtime hook after the Node adapter, preserving existing request/options signals. Combine a deadline with existing signals through supported AbortSignal APIs. Cover reading the response body as well as receiving headers, so an incomplete body cannot escape the deadline. Do not replace cancellation with only Promise.race or invent a customFetch configuration property.
- Add an atomic session-write fence tied to the verified shop/install generation and the live auth operation. A response that outlives its lock/installation must not recreate credentials. Preserve fresh-install exchange and the official session mapping/encryption path. Merely checking active status before an unlocked write leaves a race; merely shortening the HTTP timeout does not cover event-loop pauses or lost database locks.
- Prove bounded rejection/socket closure, lock release, absence of late writes, subsequent healthy refresh, uninstall/reinstall generation behavior and privacy races using disposable data. Retain the existing normal auth/session/tenant regressions. This is a separate implementation slice; no dependency override or SDK fork is required just to evaluate the runtime hook.

**Current operational restriction:** do not approve unattended order workers or merchant rollout while this race is open. Monitoring the blocked worker or manually restarting it is not a proved repair; it cannot replace a write fence. No running dev process was stopped or reconfigured in this task. For already-existing session rows, remediation must be separately scoped; this test does not authorize deleting real/dev data.

## Commands, failures and evidence boundaries

| Executed check | Result |
|---|---|
| `node scripts/auth-timeout-check.mjs` | Actual local SDK/HTTP/PG experiment completed; operational acceptance FAIL |
| `npm run typecheck` | Initial sandbox execution could not read parent Vite config directory; approved retry PASS |
| `npm run lint` | Initial unused fixture variable failed; explicit consume-only statement fixed it; final PASS |
| Final diagnostic after fixture lint correction | Completed on a new disposable database; result and fingerprints above describe the final script |
| Runtime source/schema/dependency equality to v0.8.3 | PASS; only package release-version metadata differs |
| Full233-test suite, load/restore, build, live install/browser | NOT RUN anew; application unchanged. Prior successes remain prior evidence and do not cover this newly found race |
| Advisory audit/remediation | No new audit run or dependency change here; previous4high findings remain open, not waived |

No account changes, questionnaire edits, production calls, deployment, real order requests or live deletion occurred. Previous browser refusal was not retried without an owner-side access change.

## Sources checked2026-09-30

- [Maintainer deepmerge advisory](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx) establishes the separate recursive-graph issue.
- [Shopify runtime guide](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/docs/guides/runtimes.md) documents the public abstract-fetch hook. Its presence and signature were also checked in the installed SDK exports/types; this is an advanced runtime facility, not a new OAuth flow.
- [Pinned Prisma6.19.3 transaction implementation](https://raw.githubusercontent.com/prisma/prisma/6.19.3/packages/client/src/runtime/getPrismaClient.ts) awaits the callback before commit. Current unversioned prisma.io transaction guidance redirects to newer ORM documentation and was not treated as proof of installed6 behavior.
- [Node22.18 AbortSignal APIs](https://nodejs.org/download/release/v22.18.0/docs/api/globals.html) support timeout and signal composition for the proposed cancellation layer.

Installed source inspected: SDK `lib/auth/oauth/refresh-token.mjs`, fetch-request helper, React Router offline-token refresh storage path; application `auth.server.ts`, `auth-lock.server.ts`, `session-storage.server.ts`, `order-runtime.server.ts`. Independent read-only review findings were checked against these files and then against the observed experiment.

## Release decision

**NOT READY.** New local blocker: uncancelled background refresh and late session persistence after lock expiry/uninstall. Existing independent blocker: Prisma/deepmerge advisory. Preserve all P08–P10 Shopify/privacy/provider gates, including actual embedded workflow/hydration evidence, selected compliance subscriptions/delivery, safe dev runtime provisioning, secure export, legal/support identity, production PCD and independently durable journal/backup controls. Next: implement and verify the bounded OAuth transport plus atomic stale-write rejection; neither change may be described as a fix for deepmerge.

## Follow-up0.8.5 — repair verified separately

This report remains the historical0.8.4 failure. [AUTH-REFRESH-FIX.md](AUTH-REFRESH-FIX.md) records the implemented cancellation/atomic transaction fence and passing rerun. The current runner writes fixed.json and now fails unless acceptance is PASS; result.json above remains unchanged. The dependency advisory is still open.
