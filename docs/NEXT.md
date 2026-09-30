# Next task — complete owner-operated P08

Read [STATUS](STATUS.md), [recovery evidence](DEV-RUNTIME-RECOVERY.md) and [merchant workflow](P08-MERCHANT-WORKFLOW.md). Existing database, dev preview and workers are running. Preserve their configuration and stable keys/journal. Only the selected second store preview was restored in this recovery.

Step 1 is owner-reported: correct shop/interface, no visible error. Step 2 is pending: enable High order value with explicit dev-only threshold 100.00 USD, save and reload. The quantity rule remains untouched. Verify persistence on the server before proceeding to the next single action. These values are test fixtures, not merchant defaults. Existing dev settings were absent at the read-only checkpoint.

Next prompt:

> Continue the manual P08 workflow from the current confirmed step, one owner action at a time. Correlate saves, order processing and decisions with server-side evidence without exposing identifiers or credentials. Then verify evidence, Resolve/Ignore semantics, reload, correct order link, failures/conflicts and Console/hydration where available. Keep browser-automation-only checks NOT RUN until actually executable. Do not repeat installation, reset data, invent thresholds, alter account settings or close unrelated advisory/privacy/provider/live blockers.

Browser saved denial is unchanged; chat authorization does not bypass it. Owner-operated browser evidence must remain distinct from direct automation and backend checks. No Shopify deletion or restore test is authorized on the existing development database. Runtime startup instructions are in [LOCAL-SETUP.md](LOCAL-SETUP.md).
