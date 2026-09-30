# Next task — P10B local reliability / open P10A gates

Read [STATUS](STATUS.md), [functional matrix](QA-FUNCTIONAL.md), [local setup](LOCAL-SETUP.md), [sync runbook](P04-SYNC.md) and [privacy evidence](PRIVACY-EVIDENCE.md) for the relevant checks. Candidate0.8.1 passes231 local tests; current Shopify E2E remains NOT RUN. P10A is not fully accepted.

Smallest next prompt:

> Begin the independent local part of P10B on0.8.1. Triage the two production dependency advisories with compatible updates, then exercise bounded retries/backlog/restart recovery in a separate synthetic database. Preserve exact rules, explicit thresholds, retention and monitoring boundaries. Keep P08 Shopify Admin/App Bridge and P04 live update/cancel/multi-page checks NOT RUN; keep P09 actual registration/dev setup/provider/privacy blockers. Inspect real Shopify UI only after the browser permission issue is resolved; do not work around a saved denial or repeat passed installs. No deletion/restore against live data, account/questionnaire edits, deployment, submission or external messages. Report local and live evidence separately, use codex/ branch→sanitized main→patch tag for fixes; full P10 milestone receives the next minor only after its gates pass.

P09 preparation remains documented, not applied: existing-dev migration may strip legacy session PII and pending intake-only fixtures need provenance review. This task's synthetic-only deletion permission does not authorize applying it to existing dev data. Actual privacy registration must be read from the selected Dashboard version/config-managed logs; TOML/generated payloads are insufficient. A provider backup restore/secure export handoff remains a separately verified obligation.
