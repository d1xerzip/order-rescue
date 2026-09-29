# P06A — high order value implementation

Source version **0.4.0**, rule/contract version **1.0.0**. Only `high_order_value` is implemented. P05 numeric, currency, lifecycle and availability semantics remain unchanged. `high_line_quantity`, exception lifecycle and merchant settings UI remain unimplemented.

## Changed files and boundaries

- `app/rules/contracts.ts`: explicit input, four outcomes, reason/evidence/version types and safe boundary errors.
- `app/rules/currencies.ts`: pinned Shopify2026-07 currency recognition, separate from current normalization support.
- `app/rules/high-order-value.ts`: pure `evaluateHighOrderValue` and `validateHighOrderValueSettings`. No network, database, UI, logging, ambient clock or configured price default.
- `app/order-evaluation.server.ts`: server adapter maps the already-selected snapshot and trusted context into the rule and computes a canonical SHA256 content version. This version is not ciphertext or updatedAt alone and must not be logged as anonymous data.
- `app/order-jobs.server.ts`: invokes the adapter within the existing fenced snapshot transaction. No second ingestion pipeline, schema migration, new Shopify field or scope.
- `tests/high-order-value.test.ts` and `tests/order-value-integration.test.ts`: executable acceptance and database integration tests. README, CHANGELOG, STATUS/NEXT and rule documentation record current evidence.

## Pure evaluation and settings

All context, tenant identity, generation, monitoring start, evaluation time, snapshot and settings are explicit parameters. Amounts remain strings; scaled `BigInt` comparison preserves precision and equality across decimal scales. Settings validation rejects malformed/negative/numeric thresholds, invalid versions, invalid currency and foreign tenant identity before a future configuration write. The evaluator separately handles corrupt imported settings as unknown according to P05 precedence. Disabled or unconfigured rules are not fabricated safe orders.

The configuration boundary copies and freezes allowlisted settings. It supplies no CAD100 or other merchant default. Valid Shopify currency recognition and normalized data availability are separate: USDC is a valid configuration currency; an unavailable normalized total remains unknown. An explicitly supplied amount using an unsupported normalization currency is CURRENCY_UNSUPPORTED. No conversion, refund subtraction or alternate amount source is added.

For the same explicit input including evaluatedAt and source version, the full result is identical and inputs remain unchanged. Actual later evaluations can legitimately have different evaluatedAt metadata. Source evidence remains as-of the evaluated snapshot, never a claim of live real-time state.

## Existing processing path

`processOneOrderJob(loadSnapshot, { valueSettings, now? })` accepts an explicit tenant-bound immutable settings snapshot; missing settings are null. Settings are copied before asynchronous processing and validated against the claimed shop before order fetch. Foreign/invalid explicit settings fail safely with RULE_TENANT_MISMATCH/INVALID_CONFIGURATION and no rule evidence or snapshot fetch.

Inside the existing transaction, the locked Shop supplies trusted identity, generation and monitoring start. If the fetched order loses to a newer stored snapshot, evaluation uses the stored winner. Equal-timestamp field changes receive a different canonical content digest. The result is returned only after job completion succeeds; crash, failed commit or lost completion lease emits no evidence. Existing worker logging selects operation/status only.

**Model limitation, not a hidden implementation:** there is no persisted merchant rule-settings or evaluation model yet. This slice returns an internal transient result; it does not save evaluations, create alerts or add an API/UI. The normal production-style worker currently passes no settings, so it evaluates NOT_CONFIGURED until a later authorized settings adapter supplies shop-specific configurations. The explicit valueSettings option applies to the single job actually claimed from the global queue; do not treat one shop's options as global defaults. A future settings resolver must select settings for each verified claimed shop. No development-shop setting or real threshold was installed by this task.

The existing normalized model represents agreed value/eligibility data and explicit unavailable values. No new condition requires additional order fields. Full privacy deletion/export/restore remains P09 work; transient results are not persisted beyond order retention.

## Verification and rule-card evidence

Executed local commands:

- `node --import tsx --test --test-reporter=dot tests/high-order-value.test.ts`: **53/53 PASS**, including all26 P05 high-value examples with exact expected output comparison and supplementary boundaries. Agent execution was reviewed against the source.
- `npm test -- tests/order-value-integration.test.ts tests/order-ingestion.test.ts tests/order-sync.test.ts tests/order-updates.test.ts`: **26/26 PASS** on disposable PostgreSQL (six integration plus20 existing regression tests).
- After adding explicit safe configuration-error codes and two final failure-path cases: `npm test -- tests/order-value-integration.test.ts`: **8/8 PASS**. Thus81 distinct relevant tests verified across runs, not a claimed single81-test command.
- `npm run typecheck`, `npm run lint`, `npm run build`: PASS after fixing the initially inferred job-return union to an explicit internal result type. Expected resource-route empty chunks and React Router future notices remain.

Acceptance covers CAD99.99/100.00/100.01 at fixture threshold100.00; exact large decimals and equivalent scales; unsupported/mismatched/missing currencies; missing access/amount; invalid configuration; cancellation, expiry and installation boundaries; current-total refund/discount observations without double subtraction; different settings in two synthetic shops; immutable inputs and deterministic results. CAD values occur only as fixtures. Integration covers stored-winner selection, canonical digest change, no default threshold, unknown propagation, foreign settings, crash/replay and lost completion lease.

NOT RUN: real merchant-configured rule evaluation, new real Shopify update/cancel deliveries, live multiple-page synchronization, production deployment or App Store review. P04 actual two-store small synchronization evidence is preserved; its remaining live limitations are not promoted by these tests. P02 installation checks were not repeated. No live DB migration or tunnel/firewall change was needed.

## Official guidance rechecked

Opened2026-09-29: [Order](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order), [CurrencyCode](https://shopify.dev/docs/api/admin-graphql/2026-07/enums/CurrencyCode). Versioned pages redirected to latest with2026-07 selector. The approved currentTotalPriceSet.shopMoney source, narrower installation/30day window, order PCD access and no-extra-scopes policy are unchanged. See [P05](P05-RULE-CONTRACT.md) and [P04](P04-SYNC.md).

Next: P06B, implementing only the existing per-line quantity card and reusing this result/configuration/processing boundary, after an explicit start request.
