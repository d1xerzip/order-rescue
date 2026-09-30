# P08 owner-operated development evidence — 2026-09-30

Release checkpoint 0.8.8, branch `codex/p08-form-identifiers`, based on public 0.8.7 merge `ac9a88e87116d6f96e6b5939068df05666d76d32`. Final file hashes are recorded in `SOURCE-MANIFEST.json` in the sanitized release. The application change is limited to stable id/name attributes on rule-enable checkboxes and the review-state filter in `app/components/MerchantWorkspace.tsx`. Labels, request bodies, rule evaluation and decision semantics are unchanged.

## Environment and limits

Existing owner-selected development store; actual Shopify orders containing synthetic test items, actual signed webhook intake and normal background processing against the preserved local development database. The owner operated Shopify Admin in the in-app browser. The agent reviewed supplied screenshots and performed read-only database assertions. This is not browser automation or fixture replay. Passed installation checks were not repeated. No account settings, scopes, questionnaire answers or production deployment changed.

The initial dev-runtime restoration, journal provenance/provisioning and preservation of existing rows are separately recorded in [DEV-RUNTIME-RECOVERY.md](DEV-RUNTIME-RECOVERY.md). Tests involving deletion/restore remained confined to their earlier isolated synthetic environments; none were run against the existing development data here.

Original screenshots contain development shop/order/line or registration identifiers and are retained only in the private conversation. No raw screenshots, linked configuration, tokens, customer payloads or machine identifiers are included in the public export. Sanitized observations below are evidence summaries, not substituted screenshots.

## Predetermined fixtures and observed results

| Criterion | Status | Evidence and scope |
|---|---|---|
| Existing app opens | PASS, owner-reported | Correct selected shop and interface; no visible error |
| Explicit value settings/save/reload | PASS, manual + DB | Enabled 100 USD, revision 2; encrypted settings bind to selected tenant/current generation, with settings version and actor/time |
| Value fixture | PASS, DB + screenshot | One line/currentQuantity 1, current total 150.0 USD, cancellation available/null, exact identity/timestamps; value matched/ABOVE_THRESHOLD and one Open exception |
| Value fixture delivery/repetition | PASS, DB | Two webhook-origin jobs and a reconciliation job completed without errors; one snapshot, one exception/observation; no fixture replay |
| Value evidence | PASS, screenshot | 150.0 USD against 100 USD, strictly-above explanation and history |
| Resolve/save/reload | PASS, manual + DB | Resolved revision 2; exactly one resolve/REVIEW_COMPLETED decision with actor/time, evidence and matching versions; stored order fields unchanged |
| Open in Shopify | PASS, manual URL + screenshot | Destination shop/order ID matched the checked fixture; synthetic item, quantity and amount matched. Currency comes from DB, not inference from a dollar symbol |
| Explicit quantity settings/save/reload | PASS, manual + DB | Enabled threshold 5, revision 1; value settings still 100 USD/revision 2 |
| Quantity-only fixture | PASS, DB + screenshot | One line/currentQuantity 6, total 60.0 USD; quantity matched, value not_matched/AT_OR_BELOW_THRESHOLD; both use the same snapshot/current settings; one Open quantity exception |
| Quantity delivery/repetition | PASS, DB | Three webhook-origin jobs completed on first attempt, one snapshot/exception/observation |
| First intended Ignore attempt | FAIL as attempted acceptance; explained | Unchanged assertion expected ignored but found resolved. Audit contained resolve/REVIEW_COMPLETED; owner then confirmed clicking Resolve. This does not demonstrate a UI defect. Terminal decision preserved; no reset or weakened assertion |
| Actual Ignore on separate fixture | PASS, DB + owner action | Exactly one newer order matched the same predetermined 60.0 USD/quantity 6 fixture. Three webhook-origin jobs completed; one ignored quantity exception revision 2; one ignore/NOT_RELEVANT decision with actor/time/versions and matching line evidence |
| Ignore/reload/history | PASS, owner-reported + prior DB | Ignored filter and Merchant ignored alert persisted after reload; no repeated action needed |
| Form-control Issues entry | PASS for observed reload after fix | Before: form element lacked id/name. Source confirmed this on our filter/toggles. After stable identifiers were added, owner screenshot shows only the separate deprecated-feature Issue; form-control Issue is absent |
| Current embedded hydration/error observation | PASS for this manual reload | Final screenshot shows All levels, Vite connecting/connected and no hidden-message count, red errors or hydration mismatch messages. This is a bounded observation of the supplied Console, not every interaction/browser or an automated clean-console test |
| Remaining Console notices | OPEN, observed | ShopifyQL unavailable without Direct API Access; deprecated initialization parameters; grouped timer-handler and forced-reflow performance notices. No exact provenance/causal performance diagnosis established. Do not enable extra access or suppress messages to obtain a green result |
| Remaining Issues | OPEN, observed | Deprecated unload listener remains. Filename alone does not establish whether it belongs to Shopify, a dependency or this app; no remediation claim |

Persisted job identifiers distinguish webhook-origin jobs from reconciliation. Intake code verifies original request bytes before durable receipt; the original signatures/payloads are intentionally not retained for later replay. Logs do not provide per-order HTTP response correlation, so no exact HTTP status is inferred here. Observed paid/unfulfilled labels in Admin are not added to the approved stored data inventory. Absence of a snapshot in another shop is not a foreign-ID authorization test.

## Actual commands

Private read-only operator helpers are excluded from the public source because they select this configured environment and fixture IDs. All successful assertions above ran through these commands; they did not write application data:

```text
node --import tsx .local/p08-settings-readback.mjs
node --import tsx .local/p08-order-readback.mjs
node .local/p08-order-verify.mjs
node --import tsx .local/p08-decision-readback.mjs
node --import tsx .local/p08-quantity-settings-readback.mjs
node --import tsx .local/p08-quantity-order-readback.mjs
node --import tsx .local/p08-ignore-readback.mjs
node --import tsx .local/p08-ignore-diagnostic.mjs
node --import tsx .local/p08-ignore-final-readback.mjs
```

The first Ignore assertion failed as described above; its diagnostic and the later separate-fixture assertion retain distinct evidence files. Do not retrospectively label the failed command PASS.

For the final two-line markup correction: `npm run lint` PASS; first `npm run typecheck` failed because the sandbox denied esbuild filesystem access, the same command with the permitted filesystem access PASS; `npm run build` PASS with existing empty resource-route chunks and React Router future-flag notices. Public `git diff --check` PASS. Full integration tests were not repeated for HTML identifiers; the 240-test run remains historical v0.8.5 evidence. No new implementation-mirroring tests were added.

## Remaining acceptance

Current live narrow viewport/keyboard interaction, network failure, two-tab conflict, foreign-shop direct HTTP request and broader unknown/partial-sync/pagination scenarios remain NOT RUN in this manual sequence. Earlier synthetic checks retain their original scope; P02 isolation evidence is not rerun or relabeled as current P08 HTTP evidence. Changing evidence after a terminal decision has not been exercised live here. Remaining P04 lifecycle/sync, actual P09 registration/delivery, production access, legal/support identity, provider security, export delivery, independent journal custody and dependency advisory gates stay open.

Next: inspect the app at a narrow viewport without changing records. Then address only the remaining applicable checks with isolated synthetic fault testing as required. **P08 is partially accepted, not complete; release is not production/App Store ready.**

## Follow-up0.8.9 — current evidence by environment

[P08 acceptance reconciliation](P08-ACCEPTANCE-RECONCILIATION.md) supersedes older next-step/blanket gap statements. Owner390px readability and current synthetic layout/keyboard are verified. Prior negative tests retain their scope after source/log review; no new execution or Shopify PASS is implied. Actual embedded keyboard and real exception-ID isolation remain open; other stage/security/provider gates are unchanged.
