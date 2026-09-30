# Dependency remediation decision — 0.8.3

2026-09-30; baseline `v0.8.2` / `2187d87f6837bb06e17413dee08a588bff4e8c7f`; branch `codex/dependency-remediation-plan`. This is a verified investigation and conditional migration proposal. **No supported drop-in fix was found; the advisory remains OPEN.** No dependency version, application source, database schema, encryption format or Shopify setting was changed. Package version0.8.3 identifies this documentation/evidence save only.

## Verified dependency state

| Item | Current observation | Decision |
|---|---|---|
| Installed Prisma CLI/client/config |6.19.3 /6.19.3 /6.19.3|Keep supported installed pair until a suitable fix exists |
| Highest published Prisma6 version returned by registry |6.19.3|No newer compatible6.x patch available in this query |
| Installed config dependency |Exact deepmerge-ts7.1.5|Affected by GHSA-ggr8-5vv4-36mx |
| Installed Shopify Prisma session adapter |9.0.1; Prisma/client peers ^6.19.0|Current installed peer graph passes npm ls |
| Published latest Shopify Prisma adapter |11.0.0; Prisma/client peers still ^6.19.0; SDK ^15 and storage ^7|Updating it alone does not permit a Prisma7/8 migration and introduces unrelated SDK majors |
| Published latest @prisma/config |7.10.0; still exact deepmerge-ts7.1.5|Prisma7 is not a demonstrated advisory fix |
| Registry prisma latest tag |8.0.0-rc.19; Node>=22.18.0|A dist-tag named latest is not proof of a stable release. Do not select this RC as a release fix |
| Current production audit |Exit1;4high,0low/moderate/critical|Unresolved; neither a waiver nor a clean audit |

Registry metadata was read, not installed. [Sanitized evidence](evidence/dependencies/review.json) records versions and source equality. The installed chain is `prisma → @prisma/config → deepmerge-ts`; audit also propagates the advisory to dependent packages. Four findings are not four independent vulnerabilities.

The maintainer advisory says versions below8 are affected when merging recursive JavaScript object graphs. Ordinary JSON alone cannot encode those cycles. Locally, `@prisma/config/dist/index.js` imports deepmerge inside `loadConfigTsOrJs` and passes it as the c12 merger. No direct config/deepmerge import was found in application, scripts, tests or current built server, and no project prisma.config file was found. This bounded source inspection is **not** proof of unreachability in every deployment or a reason to close the advisory. We did not execute exploit input against any service.

## Accepted auth/storage behavior to preserve

The existing EncryptedSessionStorage extends the official PrismaSessionStorage; it preserves managed Shopify auth and offline refresh, encrypts access/refresh tokens with existing AAD, strips unnecessary staff profile fields and applies privacy guards before exposing sessions. The official adapter supplies store/load/delete/delete-many/find-by-shop/isReady. No replacement implementation is introduced by this review.

`app/db.server.ts` uses two separate Prisma clients: application work and auth-lock transactions. `withAuthLock` uses a per-domain PostgreSQL advisory transaction lock with15s maxWait/60s transaction timeout; the lock holder must not depend on the waiters' exhausted connection pool. Order jobs and exceptions use other scoped locks/fences. Any database-driver migration must preserve these boundaries, BigInt IDs, exact decimal strings, UTC dates, JSON/null semantics, connection timeouts, transactions and cascade behavior.

## Concrete conditional migration proposal

These are **proposals**, not approved new architecture or implemented changes. Preference order:

1. **Upstream Prisma6 compatible patch.** Trigger: a published stable Prisma6 CLI/client/config pair uses a patched deepmerge version under the declared Shopify peer range. Pin CLI/client together, inspect the resolved config graph and run the acceptance packet below. No schema change should be necessary; confirm on synthetic existing records, not by assumption. No qualifying version was available during this review.
2. **Supported stable major stack, only if it actually removes the advisory.** Trigger: both a stable patched Prisma pair and a Shopify session adapter declaring support for it. Do not infer support from a successful TypeScript build. The current latest adapter does not meet this trigger. A future Prisma7-compatible route would require the work map below; Prisma8 must be assessed from its own stable migration guide before selection. A7 migration is not an8 plan.
3. **Project-maintained fork/patch, only as a separately reviewed fallback.** This introduces ongoing maintenance/security ownership and is not an upstream-supported fix. A scoped override across deepmerge's major boundary must not be silently applied. Before considering it, produce the exact patch, license/provenance, bounded config-merge behavior tests and maintenance/rollback plan. The current NEXT task explicitly forbids an unsupported transitive major override; none is applied here.

| Work area for a future supported major migration | Concrete change to evaluate | Required evidence before integration |
|---|---|---|
| Runtime/packages | Exact stable CLI/client/driver-adapter pair and supported Shopify peer versions; recheck Node/TS minimums | Published manifests and clean dependency resolution, no RC/force/legacy-peer-deps shortcut |
| Prisma configuration | Explicit schema/migration locations, controlled env loading and CLI datasource config | Existing runners pass generated disposable URLs; never import existing .env.local into tests |
| Client generation/imports | Evaluate new generator/output and update @prisma/client imports/types consistently | Generated models and all affected server/test modules compile; SDK adapter accepts the generated client |
| PostgreSQL driver | Configure adapter and both pools, idle/connect/query/transaction limits and TLS explicitly | Concurrent auth requests, background token rotation, query failures and connection exhaustion remain bounded |
| Persistence | Preserve current SQL migrations and table/column identities; avoid drop/reset/downmigration | Existing synthetic encrypted sessions, settings, snapshots, exceptions and histories survive migration/read-back exactly |
| Privacy/rollback | Keep keys and current independent journal outside DB backups | Restored data respects later deletion; old-compatible source or verified forward fix can recover without resurrection |

No target stable major version or custom session adapter is selected: prerequisites are absent. Swapping to another ORM/session store would expand scope and is not proposed as a quick fix.

## Acceptance packet for an actual dependency change

These commands are **future required checks, NOT RUN for a migration in this slice**:

```powershell
npm ci
npm run db:generate
npm test -- tests/storage.test.ts tests/http.test.ts tests/privacy-lifecycle.test.ts
npm test
npm run typecheck
npm run lint
npm run build
node scripts/reliability-restore.mjs
npm audit --omit=dev --json
```

Use only fresh disposable synthetic databases; ensure the test runner accepts the chosen file list. Verify encrypted session roundtrip/rotation/restart, invalid auth, foreign tenant IDs, uninstall/reinstall, pool concurrency, privacy races/current-journal restore and exact business records. If a driver changes claiming/transactions, rerun the relevant load/fault envelope. Real Shopify reopen/refresh evidence remains separately required when access is available; do not repeat passed install cycles without a regression reason. Prepared commands are not test results.

For rollback, restore original lockfile/client generation and the compatible source only after checking schema compatibility. Never overwrite the current privacy journal with an older backup. If a new migration is not backward compatible, use an isolated restore plus current deletion decisions and a forward fix; do not issue destructive downmigrations against existing dev data.

## Checks actually performed in this slice

| Command/action | Observed result |
|---|---|
| Read current STATUS/NEXT, installed manifests, db/session/auth-lock source and relevant existing test cases | Current state reconciled against0.8.2; no authentication rewrite |
| `npm view prisma@6 version --json --fetch-retries=0 --fetch-timeout=15000 --cache .local/npm-cache` | PASS; highest returned6.x is6.19.3 |
| `npm view @shopify/shopify-app-session-storage-prisma@latest version peerDependencies --json --fetch-retries=0 --fetch-timeout=15000 --cache .local/npm-cache` | PASS;11.0.0, Prisma6-only peer ranges |
| `npm view prisma@latest version engines --json --fetch-retries=0 --fetch-timeout=15000 --cache .local/npm-cache` | PASS;8.0.0-rc.19, Node>=22.18.0 |
| `npm view @prisma/config@latest version dependencies --json --fetch-retries=0 --fetch-timeout=15000 --cache .local/npm-cache` | PASS;7.10.0 with deepmerge7.1.5 |
| `npm ls prisma @prisma/client @prisma/config deepmerge-ts @shopify/shopify-app-session-storage-prisma --json` | Exit0; current installed peer graph valid |
| `npm audit --omit=dev --json --fetch-retries=0 --fetch-timeout=15000 --cache .local/npm-cache` | Exit1;4high remains |
| Runtime/test/schema/dependency equality against public0.8.2 and release JSON/link checks | PASS; only root package release-version metadata changes |
| Runtime tests/load/restore/browser | NOT RUN anew; no behavior change.233 passing tests and synthetic reliability remain dated0.8.2 evidence, not new results |

Initial non-escalated registry read failed EACCES; the bounded read-only network retry succeeded under the approval mechanism. Root branch creation initially lacked Git metadata write access and succeeded after approved escalation. No permission policy was bypassed. Raw local logs/cache paths are excluded from publication.

## Sources, opened2026-09-30

- [Maintainer advisory](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx): affected/patched versions and recursive-graph trigger.
- [Prisma6.19.3 config manifest](https://raw.githubusercontent.com/prisma/prisma/6.19.3/packages/config/package.json), [6.19.3 release](https://github.com/prisma/orm/releases/tag/6.19.3): exact pin; that release's security patch concerns effect, not this advisory.
- [Prisma7.10.0 config manifest](https://raw.githubusercontent.com/prisma/orm/7.10.0/packages/config/package.json): still7.1.5.
- [Upstream issue30052](https://github.com/prisma/orm/issues/30052): open bump request. Its author's reachability opinion is not maintainer security approval.
- [Official Shopify adapter manifest](https://raw.githubusercontent.com/Shopify/shopify-app-js/main/packages/apps/session-storage/shopify-app-session-storage-prisma/package.json): latest source peer ranges; separately checked against published npm metadata.
- [Prisma7 migration guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7): configuration/generator/driver/pool changes. Its current-version banner is not evidence that registry latest is stable.
- [npm Prisma metadata](https://registry.npmjs.org/prisma), [config metadata](https://registry.npmjs.org/@prisma%2fconfig), [Shopify adapter metadata](https://registry.npmjs.org/@shopify%2fshopify-app-session-storage-prisma): read via npm view as above.

Unverified pages are not relied upon: the attempted Shopify custom-session-storage guide URL was inaccessible; the attempted Prisma8 config source URL did not establish a supported patch. We used the installed official adapter interface and verified published manifest instead, without inventing a new API.

## Readiness / next

Supported dependency remediation is blocked on upstream compatibility, not on an owner login. No owner threshold/data permission/account decision is needed for this investigation. Keep the advisory open; do not deploy based on bounded reachability analysis. P08–P10 live/privacy/provider gates are unchanged.

The smallest independent next engineering slice is a synthetic local test of **actual background-authentication HTTP timeout/cancellation** (the P10B injected TimeoutError did not prove it), followed by a bounded compatible fix if required. Preserve the official auth flow, keep all network fixtures on loopback, and do not call real Shopify or mutate existing dev data. This is the next prompt in [NEXT.md](NEXT.md), not work performed here.

## Follow-up0.8.4: distinct reliability defect observed

[Actual local HTTP diagnostic](AUTH-TIMEOUT-DIAGNOSTIC.md) now records FAIL: refresh survives auth-lock expiry and writes a session after uninstall. This is a separate auth lifecycle defect. No deepmerge input was tested or patched, no dependency version changed, and the advisory remains OPEN. The next auth correction must not be presented as dependency remediation.
