# Project instructions

Use the existing React Router/TypeScript/PostgreSQL foundation. Read docs/STATUS.md and the task-specific document before changing code. Preserve unrelated changes.

Derive tenant identity from verified server authentication. Keep Shopify credentials server-side and out of logs. Use disposable synthetic fixtures. Resolve and Ignore affect app records, never Shopify orders. Do not add AI, messaging, billing or order mutations without a separately agreed scope.

Keep official platform documentation and implementation evidence distinct. A mock, syntax check, preview or build does not prove live Shopify access. Run proportionate checks; document failures and unexecuted checks. Never store raw customer payloads in diagnostics.

Production deployment, public publication, external messages, account changes and real charges require specific authorization. See docs/LOCAL-SETUP.md for commands, docs/ARCHITECTURE.md for security/data, docs/RULES.md for semantics and docs/P03-ACCESS-PLAN.md for development access.

## Milestone versions and publication

Use `codex/` for new working branches unless the owner requests another name. After an accepted milestone, record the version, changes, executed checks and remaining limitations in CHANGELOG.md and docs/STATUS.md. Use minor versions for completed milestones and patch versions for fixes; mark unfinished work WIP rather than tagging it complete.

Preserve existing explicit publication authorization within its scope. Publish only the reviewed sanitized source edition, never private history, credentials, machine paths, account/store identities or operational receipts. Keep local checkpoints separate from public history; do not rewrite unrelated commits. Tag the published version and verify the remote result. Source publication does not authorize deployment, account changes or App Store review submission.

For ingestion recovery or synchronization, read docs/P04-SYNC.md; use docs/NEXT.md for the next slice. Do not reread all documentation or repeat passed installation checks without a relevant reason.

After completion and verification, merge each update branch into main and create its version tag. Keep previous tags available; no separate approval is needed for the already authorized sanitized source-save workflow.


For P05 contracts/fixtures read docs/P05-RULE-CONTRACT.md. Specifications are not executable rule evidence.

- Exception transitions, persisted rule settings/evaluations, decision audit and P07 API boundaries: [P07-LIFECYCLE.md](docs/P07-LIFECYCLE.md). Keep terminal decisions closed under automatic reevaluation; never invent a merchant threshold.

- P08 merchant workflow, pagination contract, synthetic browser harness and live acceptance limits: [P08-MERCHANT-WORKFLOW.md](docs/P08-MERCHANT-WORKFLOW.md). Never treat harness-supplied synthetic tokens as App Bridge integration proof.

- Privacy/data deletion/export/restore: read [PRIVACY-EVIDENCE.md](docs/PRIVACY-EVIDENCE.md), [PRIVACY-SUPPORT.md](docs/PRIVACY-SUPPORT.md) and [current platform research](docs/P09-PLATFORM-RESEARCH.md). Preserve the independent journal; test deletion/restore only in a disposable synthetic database. Prepared export is not delivery. Never change questionnaire answers without separate owner agreement.


- Functional release acceptance/current browser limits and P10B dependencies: [QA-FUNCTIONAL.md](docs/QA-FUNCTIONAL.md). Distinguish synthetic/local PASS from current Shopify E2E; retain live/privacy blockers. Independent local P10B is permitted, but full P10A acceptance is still open.

- Operational reliability/load/fault/backup/rollback: [QA-RELIABILITY.md](docs/QA-RELIABILITY.md), [P10B-RESTORE.md](docs/P10B-RESTORE.md). Use isolated synthetic databases only; preserve the independent current privacy journal. Local envelope PASS is not real pilot capacity or closure of P08–P10 live/provider gates.

- Dependency updates/security disposition: [DEPENDENCY-REMEDIATION.md](docs/DEPENDENCY-REMEDIATION.md). Preserve supported SDK/Prisma peer contracts; latest dist-tags or local passing tests do not establish upstream support. No forced transitive major overrides.

- Auth HTTP timeout/late credential writes: [AUTH-TIMEOUT-DIAGNOSTIC.md](docs/AUTH-TIMEOUT-DIAGNOSTIC.md). Diagnostic completion can record acceptance FAIL. Keep the observed auth race separate from the deepmerge dependency advisory; require actual cancellation and atomic stale-write rejection before closing it.

- OAuth cancellation and atomic session fencing: [AUTH-REFRESH-FIX.md](docs/AUTH-REFRESH-FIX.md). Preserve the lock-owning transaction for credential/activation writes, reject stale contexts and test header/body stalls on loopback. Keep0.8.4 historical FAIL and0.8.5 correction evidence distinct; neither closes the dependency advisory or live gates.
