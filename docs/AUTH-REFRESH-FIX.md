# OAuth cancellation and atomic session fence — 0.8.5

2026-09-30; branch codex/auth-refresh-fence; public baseline v0.8.4 / e2ee3592b5299f644ebb84d8c220ef3171ac3ff9. This patch fixes the locally reproduced auth lifecycle defect. It does not remediate GHSA-ggr8-5vv4-36mx or close Shopify/provider/privacy acceptance.

## Behavior and transaction boundaries

- The supported Shopify setAbstractFetchFunc hook is installed after the Node adapter. Only the HTTPS myshopify.com /admin/oauth/access_token endpoint gets a 10-second deadline. It composes the Request signal, RequestInit signal and current auth-operation cancellation; other SDK requests retain their existing behavior.
- Native fetch keeps the signal while the official SDK consumes response.json(). Both a server that sends no headers and an incomplete JSON body are cancelled. This is transport cancellation, not Promise.race. The afterAuth shop-identity GraphQL request also has a 10-second signal.
- withAuthLock owns the per-shop salt1 PostgreSQL advisory transaction lock. Its AsyncLocalStorage context carries the actual transaction, shop domain and liveness. EncryptedSessionStorage still extends the official PrismaSessionStorage; a delegate proxy routes SDK Session operations to that same transaction, preserving official row mapping and encryption/AAD.
- Activation, active-installation checks, uninstall deactivation and afterAuth jobsEnabled reuse the owning auth transaction, taking salt0 only after salt1. Credential persistence and installation activation therefore commit together. Auth failure/transaction expiry rolls them back. Uninstall cannot interleave between a session write and that commit.
- A callback whose transaction has ended cannot fall back to the ordinary Prisma client. Closed context throws STALE_AUTH_OPERATION; a still-active JavaScript callback with a dead database transaction fails at the SQL boundary. Cross-domain context is rejected. Production session writes without context fail AUTH_OPERATION_REQUIRED; only explicit disposable-test mode allows fixture seeding outside it.
- Fresh install/reinstall uses a new verified auth operation. Existing installation-generation checks deny old ordinary jobs. No new schema or generation convention is introduced. Privacy deletion keeps the existing salt1/salt0 lock order and independent journal. Privacy reads inside authentication use the same transaction, so uncommitted activation is visible without self-deadlock.

The atomic fence is the transaction that owns the lock, not an unlocked pre-write active check. A timeout alone would be insufficient during event-loop pauses or lost DB connections. The dead-backend regression deliberately keeps JavaScript context active to prove this distinction.

## Before / after evidence

Historical v0.8.4 [result.json](evidence/auth-timeout/result.json) remains FAIL: no abort signal, socket open at65s, late encrypted Session after uninstall, eventual P2028. It is not overwritten.

The same real loopback HTTP / actual installed Shopify SDK experiment now writes [fixed.json](evidence/auth-timeout/fixed.json). Exact source fingerprints are recorded before/after execution. The command fails if acceptance is not PASS.

| Observation | Fixed run |
|---|---|
| Normal delayed refresh |325ms; encrypted persistence verified |
| Stalled refresh settles |10030ms; target <=15000ms |
| Socket at16s and65s |Closed |
| Uninstall after observation window |19ms; session rows0 |
| Late credential persistence |False |
| Ordinary access after uninstall |Denied |
| Privacy intake without offline session |200; this is not export delivery |
| Subsequent healthy shop call |7ms; valid-token reuse, not a second refresh |

Fresh refresh recovery is separately tested after both header/body timeouts: the server switches to a valid response, the actual SDK rotates both tokens, encrypted stored values change and decode to the expected synthetic credentials.

## Regression acceptance

All tests use new isolated synthetic PostgreSQL databases. The fixture server is bound to loopback on an allocated port; the fetch adapter rejects every destination except generated fictional shops forwarded to this server. No real Shopify request, merchant data, existing dev database, account change or live deletion is involved.

| Case | Result / assertion |
|---|---|
| No headers; incomplete body |PASS: ~10s cancellation, actual socket closure, exact original Session unchanged, next refresh succeeds |
| Incoming Request / RequestInit cancellation |PASS: both signals retained; connection closes within1.5s |
| Four concurrent refreshes |PASS: one token exchange, all callers get rotated session; other-shop stored row unchanged |
| Refresh alongside signed uninstall |PASS: serialized completion, inactive shop, zero sessions |
| Reinstall / detached old callback |PASS: new generation/session preserved; old callback and old-generation jobs denied |
| Lost auth DB transaction while callback still active |PASS: terminate only positively identified backend in disposable database; old activation and Session write fail; exact new Shop/Session rows unchanged |
| Foreign domain / missing auth context |PASS: both writes rejected; foreign row unchanged |
| Privacy deletion versus credential write / reinstall |PASS: transaction-local write is invisible globally until commit; pending privacy blocks reads; final deletion removes Shop/Session and denies ordinary access |
| Existing managed auth/session/tenant behavior |PASS in full suite: invalid auth, fresh synthetic install, reopen/rotation, uninstall/reinstall, scoped access and encrypted mapping |

Terminated-backend reinstall setup intentionally uses the other pool and the explicit test-only fixture permission while the old callback is paused. It is an adversarial DB-fence test, not proof of a live Shopify install. Existing HTTP tests exercise the official managed-auth path with synthetic transport.

## Commands actually executed

| Command | Result |
|---|---|
| node scripts/auth-timeout-check.mjs |PASS; new cluster55436; 65-second observation; fixed.json |
| npm test -- tests/storage.test.ts tests/http.test.ts tests/privacy-lifecycle.test.ts |Initial47-test run:46 PASS,1 FAIL; old visibility assertion expected a readable session despite pending privacy. Corrected to assert transaction-local row, global invisibility and privacy denial |
| npm test -- tests/auth-refresh-fence.test.ts tests/storage.test.ts tests/http.test.ts tests/privacy-lifecycle.test.ts |Initial54-test run:53 PASS,1 FAIL; new synthetic uninstall fixture lacked required x-shopify-api-version header. Added it; no production verifier weakened |
| npm test |PASS:240/240;0 failed/skipped;59666.8889ms; includes all affected cases and seven new tests |
| npm run typecheck |PASS |
| npm run lint |PASS |
| npm run build |PASS; existing React Router future-flag warnings remain |
| node node_modules/typescript/bin/tsc --noEmit --pretty false |PASS after final fixture correction |
| node node_modules/eslint/bin/eslint.js tests/auth-refresh-fence.test.ts --no-cache |PASS after final fixture correction |

[Sanitized regression evidence](evidence/auth-timeout/regressions.json) binds final counts, case durations and source hashes. Private raw logs, synthetic secrets/databases and machine paths are excluded. Independent read-only review found no new blocking race/deadlock; its findings were checked against source and the executed tests.

## Limits and remaining blockers

- No fresh Shopify browser/live token-refresh/actual revocation check. No DNS/TLS/proxy or real merchant capacity claim. P08 Admin/App Bridge/workflow/order-link/embedded Console and P04 update/cancel/multipage live gates stay open.
- Ten seconds is a per-OAuth transport deadline, not a guarantee for total queued auth latency. Existing auth pool maxWait15s and transaction60s still bound other waits; lock/pool contention can reject. Privacy intake may return a retryable failure while lifecycle locks are held; it must not claim durable acceptance on failure. Fairness/load profile was not rerun.
- SDK credential invalidation attempted after the owning auth operation has finished fails closed. Do not silently open a new transaction to save that stale Session. Current background SDK client has no such invalidation handler; future external use of a returned browser Admin client must respect this boundary. Real reconnect UX remains unverified.
- Existing-dev migration/journal/worker/provenance, selected privacy subscriptions and actual delivery, secure export handoff, production PCD, legal/support identity, provider TLS/storage/log/backups and independent journal custody remain open. Current journal and live data were not touched.
- Schema/dependency versions unchanged; only package release metadata advances. No fresh audit or forced override. The previous four high audit findings from the deepmerge dependency chain remain OPEN. No fresh load/backup/restore or browser run is claimed; prior evidence keeps its original environment/date.

Decision: the reproduced local auth race is fixed with regression evidence. Overall release remains NOT READY for pilot, production or App Store submission.

## Sources checked2026-09-30

- [Official Shopify runtime guide](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/docs/guides/runtimes.md): public abstract-fetch hook, cross-checked against installed SDK exports/types.
- [Node22.18 AbortSignal APIs](https://nodejs.org/download/release/v22.18.0/docs/api/globals.html): timeout and signal composition.
- [Pinned Prisma6.19.3 transaction implementation](https://raw.githubusercontent.com/prisma/prisma/6.19.3/packages/client/src/runtime/getPrismaClient.ts): callback and commit lifetime; DB transaction timeout does not cancel arbitrary JavaScript.

Installed source also verified: Shopify SDK13.1.0 refresh-token/fetch-request; Prisma session adapter9.0.1 mapping/delegate calls; React Router offline-token storage and Admin-client invalidation behavior. No unsupported new OAuth protocol or adapter fork is introduced.
