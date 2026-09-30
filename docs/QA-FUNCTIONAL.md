# P10A — functional acceptance evidence

2026-09-30. Baseline: public `v0.8.0`, commit `dbc08262e12156898221bb19aad919aca6050710`. Candidate: **0.8.1**, `codex/p10a-functional-qa`. This is a verified local repair/QA increment, **not a completed Shopify release gate**. The sanitized release commit/tag and `SOURCE-MANIFEST.json` bind the final files; historical evidence is not silently upgraded to current live evidence.

Tested runtime fingerprint: `1cce28c0a393959d669a0a1c354073b7ba4a4cccc99e5710429b7e3d7f2ecaec` over94 allowlisted app/tests/scripts/Prisma/package/runtime configuration files. Publication compared those files against the tested tree, normalizing line endings/BOM/trailing end-of-file whitespace and mapping portable migration directory names. Application/test content matches. Linked Shopify account configuration, private evidence and environment values are excluded; synthetic test transport/environment is stated below. This is not a test of real linked account registration.

## Environment and scope

Windows, Node22.18.0/npm10.9.3; actual PostgreSQL18 on loopback55433. `npm test` creates a fresh `rescue_test_*` database, synthetic keys and an independent test journal. Browser harness creates a separate `rescue_ui_test_*` database and serves the production React Router build on loopback3108. Tests use real SDK server authentication with synthetic signed tokens and mocked Shopify transport. They do not load `.env.local` or contact Shopify. Existing development database on55432, its records and running Shopify tunnel were not changed. All erasure/restore tests used disposable synthetic records only.

Accepted scope remains exactly two rules, explicit merchant thresholds, original-createdAt+30day retention and current-installation monitoring; no order mutations, AI, customer messaging, extra fields/scopes or paid billing. See [product](PRODUCT.md), [rules](RULES.md), [lifecycle](P07-LIFECYCLE.md), [privacy evidence](PRIVACY-EVIDENCE.md). An independent reviewer identified the persisted-setting/normal-pipeline dataset and sync-status authentication gaps; both were added and their source/assertions independently inspected before execution.

## Criterion-to-evidence matrix

PASS is limited to the stated environment. Live NOT RUN remains open even when its local counterpart passes. Test paths refer to this candidate's committed source. Historical install/ingestion observations remain bounded by their earlier versions.

| Criterion | Local candidate | Current Shopify E2E | Evidence / observation |
|---|---|---|---|
| Install, reopen, restart and persisted sessions | PASS | NOT RUN; prior P02 cycle retained, not repeated | `tests/http.test.ts`, `storage.test.ts`; actual PostgreSQL and SDK mock. No claim of a new installation |
| Invalid/expired/wrong-audience access and token lifecycle | PASS | NOT RUN | `http.test.ts`, new `qa-functional.test.ts`; sync401 before identity/data reads, tenant from signed context rather than foreign query |
| Original-byte order HMAC, durable receipt, DB outage | PASS | NOT RUN; prior P03 order-created observations retained | `order-ingestion.test.ts`; invalid401/zero write, DB503, durable job before2xx |
| Duplicate/concurrent/crash replay | PASS | NOT RUN | Ingestion/update/evaluation suites; unique job/order/exception identity, safe claims, replay does not add history or active alerts |
| Both rule boundaries and same-currency exact money | PASS | NOT RUN | `high-order-value.test.ts`, `high-line-quantity.test.ts`, release dataset; CAD99.99/100.00/100.01 and quantities4/5/6 |
| Per-line policy, no match, both match | PASS | NOT RUN | Two lines of3 are not aggregated; order98003 matches both in A and neither in B |
| Unknown vs empty vs lifecycle exclusion | PASS | NOT RUN | Missing total/lines stays unknown; known empty lines stays not_matched; new cancelled order not_applicable; no false safe order |
| Shop-specific settings, validation, persistence/versioning | PASS | NOT RUN | Settings HTTP boundary and dataset persist explicit A100/5, B200/7; invalid values rejected; no merchant default |
| IDs, exact selected fields, times and shared snapshot | PASS | NOT RUN | `qa-functional.test.ts` compares decrypted entire normalized snapshot, rule/settings versions, source hash and literal evidence, not only counts |
| Current refund/cancellation/partial-fulfillment semantics | PASS | NOT RUN for real update/cancel | Dataset plus rule/update suites. Current amount/quantity fields change; prior open review remains with visible not_matched/not_applicable. No fulfillment-status filter was added |
| Stale events, equal timestamps, sync races and recovery | PASS | NOT RUN for live multi-page/update cases | `order-updates.test.ts`, `order-sync.test.ts`, `order-api.test.ts`, `order-discovery.test.ts`; reversed/omitted event, interrupted page/checkpoint replay, throttling/partial200 errors |
| Exception transitions, action audit and concurrency | PASS | NOT RUN | `exception-lifecycle.test.ts`, `exception-http.test.ts`; revision-bound decision/audit, concurrent actions, terminal decisions survive changed evidence/settings |
| Direct foreign IDs/read/write/tenant cursors | PASS | NOT RUN for current candidate | New dataset HTTP GET/POST404 and target unchanged; pagination tests; browser harness foreign probe404/404 and unchanged=true |
| Uninstall/reinstall and privacy path remains available | PASS | NOT RUN; earlier install cycle not repeated | Storage/privacy suites; ordinary work stopped, privacy still authenticates without active session; late work blocked |
| Privacy request/export/redaction/restore/expiry | PASS synthetic only | NOT RUN | All25 privacy cases rerun in fresh DB; [P09 evidence](PRIVACY-EVIDENCE.md). Fixture restore is not a provider backup restore or compliant export handoff |
| Onboarding/empty/loading; no invented threshold | PASS synthetic browser | NOT RUN | Blank disabled settings and explicit input checked; no-match dataset creates no new exceptions. Empty UI does not claim safety |
| Order→inbox→evidence→Resolve/Ignore→reload | PASS synthetic browser | NOT RUN | Order9103 through normal queue; value Resolved/quantity Ignored; server-confirmed responses and reload preserve state |
| Two-tab conflict recovery updates list and detail | PASS after repair | NOT RUN | First tab Resolve; second stale Ignore409; Load latest record shows Resolved in both views. Fixed `MerchantWorkspace.openDetail`; earlier stale list was FAIL |
| Failed action and retry; no false success | PASS synthetic browser | NOT RUN | Injected HTTP503 leaves Open with explicit unconfirmed-write message/actions disabled; Load latest then Ignore succeeds |
| Settings save by keyboard and reload | PASS synthetic browser | NOT RUN | Explicit quantity6 entered via Enter, Saved observed, reload still6. Earlier candidate onboarding used CAD100/5; all values are fixtures |
| Unknown/stale/partial-sync UI | PASS synthetic browser | NOT RUN | Order9104 required fields unavailable, coverage says Unable to evaluate; incomplete sync and old evidence warnings, no extra false exception |
| Open in Shopify | PASS href only | NOT RUN actual navigation | Signed shop context + saved order9103 produces `https://merchant-a.myshopify.com/admin/orders/9103`; fictional link not followed |
| Narrow layout and keyboard | PASS within tested scope | NOT RUN Shopify viewport | Harness390px iframe/content375px with scrollWidth375, rendered layout inspected, row opened via Enter. IAB viewport override did not resize direct tab; no separate390px-direct-tab claim |
| Browser hydration and Console | PASS local IAB after repair | NOT RUN Shopify embedded hydration | Fresh direct default-entry React19.3 build logs[]; interactions/save/reload work. Prior React18 IAB errors418/423 reproduced. No warning suppression/custom recovery entry shipped |
| Pagination | PASS local integration | NOT RUN fresh visual pagination / Shopify | Existing bounded list/history/cursor regressions rerun; earlier P08 visual checks retained as historical evidence only |
| Actual privacy registration/deadlines/operator environment | NOT RUN | NOT RUN | Local TOML is not proof of subscriptions. Existing dev P09 migration/journal/worker not run; pending legacy fixtures need provenance review |
| Billing / extra rules / Shopify order writes | N/A | N/A | Free V1, two rules, read-only Shopify scope; these are explicit non-goals, not missing tests |

## Predetermined dataset and reproducible assertions

[p10a-release.json](fixtures/p10a-release.json) fixes13 literal expected cases before app setup. A uses explicit CAD100.00/quantity5; B CAD200.00/quantity7. Relative timestamps bind once to the run clock, not evaluator output. Cases cover boundaries, shared Shopify ID under different tenants, two lines of3, missing money, missing/empty lines, currency mismatch, cancellation and current-field refund changes. `tests/qa-functional.test.ts` saves settings through authenticated handlers and runs the existing accepted-job worker, without injecting transient thresholds or adding a pipeline.

Reproducible records: A/98003 starts with exact CAD100.01 and line501 quantity6, two matched evaluations and two open exceptions. Cancellation revision2 retains those identities/open review while both latest results become `ORDER_CANCELLED`/not_applicable. A/98010 changes150.00/6→90.00/4; latest results become not_matched but prior review is not silently cleared. B/98003 has the same Shopify order ID and data yet no exceptions at B's settings. Unchanged replay compares full exception rows/revisions/history. Foreign signed GET/POST returns404 and leaves the target identical.

## Commands actually executed

| Command | Observed result |
|---|---|
| `npm view react version`; `npm view react-dom version`; types package version queries | Stable React/runtime/types19.3.0 |
| `npm install --save-exact react@19.3.0 react-dom@19.3.0` | Dependency install completed; subsequent combined shell sequence interrupted before types command. Not claimed as a fully successful batch |
| `npm install --ignore-scripts --no-audit --no-fund --save-dev --save-exact @types/react@19.3.0 @types/react-dom@19.3.0` | PASS |
| `npm ls react react-dom @types/react @types/react-dom --depth=0` | PASS, all19.3.0; installed router/Shopify SDK peer declarations permit React>=18 |
| `npm run build` then `node scripts/ui-test-server.mjs` | PASS; actual production build/browser scenarios above; disposable server stopped after inspection |
| `npm test -- tests/qa-functional.test.ts` | **17/17 PASS**, includes13 dataset subcases and four top-level tests |
| Final `npm test` | **231/231 PASS**,0 failed/skipped/cancelled; fresh separate PostgreSQL database |
| Final `npm run db:generate`; `npm run typecheck`; `npm run lint`; `npm run build` | PASS; generation only, no existing-dev migration |
| `npm audit --omit=dev --json` | Exit1:5 production entries (4high/1low), two underlying advisories; unresolved, not clean/PASS |

Private command logs are excluded from public source. Assertions/fixtures and sanitized observed screenshots reproduce the useful evidence: [ignored evidence/history](evidence/p10a/ignored-evidence.png), [actual narrow harness](evidence/p10a/harness-narrow.png). Screenshots contain fictional shops/orders only. The QA JSON-report navigation was blocked by the browser client; the same safe summary was read in the visible harness disclosure: qaActions6, actionErrors0, foreign404/404, foreignUnchanged=true, failedActions1.

## Repairs, sources and dependency limits

The local IAB inserted a third-party comments-root div under HTML before React18 hydration. Direct child-page logs reproduced errors418/423 even when the parent iframe Console was empty. React19.3/runtime/types now hydrate using the normal React Router entry; no diagnostics/logging/recoverable-error suppression remains. After repair direct-page Console stayed empty across interaction/reload. Shopify's current template still declares React18.3.1; this is an existing-app compatible dependency repair, not a claim that the template selects19.

Official sources opened2026-09-30: [hydrateRoot](https://react.dev/reference/react-dom/client/hydrateRoot), [React19 third-party DOM handling](https://react.dev/blog/2024/12/05/react-19), [upgrade guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide), [stable React releases](https://react.dev/blog), [Shopify template package](https://raw.githubusercontent.com/Shopify/shopify-app-template-react-router/main/package.json). Installed package peer declarations were also inspected; existing SDK/auth/transport and rule semantics were preserved.

Audit findings: [deepmerge-ts GHSA-ggr8-5vv4-36mx](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx) (patched>=8.0.0) reaches the Prisma config loader; [esbuild GHSA-g7r4-m6w7-qqqr](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr) (patched>=0.28.1) concerns its Windows serve/servedir mode. Sources and installed call sites inspected2026-09-30. No exposed cyclic-JS config merge or esbuild serve call was found in current app/scripts/Vite paths; this is bounded reachability analysis, **not a security clearance**. Compatible updates remain a P10B dependency. No forced incompatible Prisma downgrade or weakened tests were used.

## External blockers and P10B decision

The owner reports both Shopify domains set to Always allow. Explicit retry of both still failed in **Codex In-app Browser (`iab`) / `mcp__cua_repl`**: “Browser Use rejected this action due to browser security policy. Reason: A saved user permission setting blocks this action.” The tool also states browser access is blocked and prohibits alternate-browser/raw-CDP/indirect workarounds. Thus no current Shopify page/subscription inspection was possible; no settings/questionnaire/review changes occurred.

Keep open: P08 actual Admin/App Bridge/workflow/order-link/embedded Console; P04 actual update/cancel and multi-page recovery; P09 actual subscription/delivery, safe existing-dev schema/journal/worker setup after legacy fixture review, production PCD, legal/support identity, secure export handoff, hosting/TLS/volume/log/backups and independently durable current journal. Local hydration repair closes only its reproducible synthetic IAB defect; actual Shopify hydration remains NOT RUN.

**P10B may proceed only for independent local reliability and compatible dependency triage. Full P10A acceptance and the candidate deployment/listing gate cannot pass yet.** Next prompt: [NEXT.md](NEXT.md). Version0.8.1 is a patch repair/evidence save, not a completed P10 minor milestone. No live erasure/restore, account change, deployment, review submission or external message is authorized by this report.
