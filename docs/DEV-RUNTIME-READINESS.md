# P08 development runtime preflight — BLOCKED

2026-09-30; inspection target v0.8.5 / c706d7eaa8c1898eb15dd33ef804c5d6d9e26976. Documentation save0.8.6 on codex/dev-runtime-readiness; application, tests, schema and dependency versions unchanged.

## Browser gate, checked first

Browser: **Codex In-app Browser**, selector iab; tool mcp__cua_repl. Browser inventory was available; both requested Shopify page operations were denied before page content could be read.

Exact error for Shopify Admin:

> Browser Use rejected this action due to browser security policy. Reason: A saved user permission setting blocks this action. Browser use cannot access https://admin.shopify.com because the user has a saved preference that blocks it. The agent must not attempt to achieve the same outcome via workaround, indirect execution, raw CDP or browser commands, alternate browser surfaces, or policy circumvention. Proceed only with a materially safer alternative that does not require this blocked browser action; if none exists, stop and request user input.

Exact error for Dev Dashboard:

> Browser Use rejected this action due to browser security policy. Reason: A saved user permission setting blocks this action. Browser use cannot access https://dev.shopify.com because the user has a saved preference that blocks it. The agent must not attempt to achieve the same outcome via workaround, indirect execution, raw CDP or browser commands, alternate browser surfaces, or policy circumvention. Proceed only with a materially safer alternative that does not require this blocked browser action; if none exists, stop and request user input.

This is a browser-tool saved permission denial, not an observed Shopify login failure or app error. Earlier owner reports of Always allow do not establish current tool access. No alternate browser, HTTP proxy, raw CDP or screenshot workaround was attempted.

## Independent read-only runtime checks

| Criterion | Observation / disposition |
|---|---|
| Selected local development DB |Configured for expected loopback dev endpoint, currently unreachable; not started |
| Current migration state |NOT RUN: DB unavailable. Last recorded P08 migration success and P09 pending status remain historical, not a new DB read |
| Web server / health / readiness |Expected local listener absent; /healthz and /readyz NOT RUN, not claimed HTTP503 |
| CLI dev, tunnel, ordinary/privacy workers |No matching process candidates found by successful read-only OS query; no service started/stopped |
| Required privacy configuration |PRIVACY_LEDGER_KEY and PRIVACY_JOURNAL_PATH absent from the selected env file. No valid independent journal configuration established |
| Credentials |Presence/format checks only; no values printed. No token refresh, decrypt/export or credential change |
| Application URL |Absent from selected env file; CLI normally injects it. This alone does not prove invalid app registration or App Home |
| Existing privacy receipts / journal provenance |NOT RUN. No deletion worker, cleanup, migration, empty-journal initialization or restore permitted as a shortcut |
| Runtime ready for actual P08 |NO; browser and local prerequisites both unresolved |

The configuration inspection describes the selected env file, not a running process environment. An unconfigured journal path does not prove that no earlier journal exists elsewhere. Never replace an existing independent journal with an empty file.

Private preflight output contains only safe status fields and remains excluded from source publication. Linked store/app IDs, local absolute paths, browser inventory of unrelated tabs and process command lines are excluded.

## Commands / actions and limits

- mcp__cua_repl: cua.getState(), then createBrowserTab for the existing selected dev app in iab and a separate https://dev.shopify.com access check: inventory PASS; both site actions BLOCKED as quoted.
- Read project STATUS/NEXT, LOCAL-SETUP, P08 workflow, QA-FUNCTIONAL, privacy support/guard and readiness source.
- Get-CimInstance Win32_Process with only node/cloudflared/postgres filters, returning boolean candidate-presence fields. Initial sandbox query: access denied, so its derived zero values were discarded. Approved read-only retry succeeded.
- node --import tsx .local/dev-runtime-readiness.mjs: private preflight helper, read-only env presence/format and loopback checks. Initial sandbox tsx initialization failed uv_os_get_passwd/ENOMEM; approved retry succeeded. No DB query ran because the selected socket was unreachable.
- Runtime/tests/schema/dependency equality and sanitized documentation/manifest checks: performed for the source save. No full suite/build/browser harness rerun: application unchanged. Latest240-test PASS belongs to v0.8.5, not this live gate.
- No account/questionnaire changes, real order creation/read, merchant setting writes, app actions, install repetition, migrations or live deletion.

## Owner action and next packet

1. In the desktop app, open **Settings > Browser**, inspect the individual allowed/blocked entries for **admin.shopify.com** and **dev.shopify.com**, and remove the saved block or permit those specific sites. Do not enable unrestricted global access, change Shopify scopes or use a different browser to evade the rejection.
2. If both already show permission, report that inconsistency with the exact error above through the app's normal support channel; another statement of approval in chat cannot override the tool. No documented guaranteed reset/restart cure is claimed. After an actual permission-state correction, request one fresh access check. If login is then shown, the owner signs in on the page without sending passwords/tokens in chat.
3. Browser access alone will not prepare the runtime. The next separately scoped preparation must inspect the existing DB/migrations and legacy privacy-receipt provenance read-only, locate/preserve the current independent journal and keys, and propose any required additive migration/provisioning before executing it. Do not run worker:privacy on unknown legacy shop/redact fixtures.
4. After approved preparation, run the supported existing dev CLI and separate workers, establish the current HTTPS URL and /readyz, then execute outstanding P08 only on identified synthetic dev records with explicitly chosen test thresholds. No need to repeat passed installation cycles.

Prepared P08 acceptance remains **NOT RUN**: synthetic dev order -> inbox -> evidence -> Resolve/Ignore -> reload; explicit settings persistence; correct Shopify order link; two-tab conflict; network-failure feedback; rejected foreign ID; narrow viewport/keyboard; embedded Console/hydration and sanitized screenshots. Resolve/Ignore only affect app state. Transport errors must be injected only in a scoped test/browser context, never by stopping shared services.

Keep all P04 remaining live, P09 registration/delivery/provenance/provider, production PCD/legal/support/export/journal-custody gates and the Prisma/deepmerge advisory OPEN. v0.8.5 fixes the local auth race; it does not make this runtime or release ready.

Official owner-control source opened2026-09-30: [OpenAI Browser documentation](https://learn.chatgpt.com/docs/browser?surface=app), Computer Use section, documents Settings > Browser for allowed/blocked sites. It does not establish that this installation's permission inconsistency is repaired. The attempted unlocalized developers.openai.com/docs/browser URL returned404; the official redirected Learn page was successfully opened.
