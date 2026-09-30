# Next task — remove browser blocker and prepare dev-runtime safely

Read [STATUS](STATUS.md) and [DEV-RUNTIME-READINESS.md](DEV-RUNTIME-READINESS.md). Both Shopify domains still have an enforced saved browser denial. Runtime preflight is also not ready; no account or data changes were made.

Owner action: Settings > Browser -> individual entries for admin.shopify.com and dev.shopify.com. Remove the saved block/permit these sites. If the UI already permits them, resolve the interface/tool inconsistency using the exact error in the report; no alternate-browser/CDP workaround. Retry once only after a meaningful permission correction. No credentials in chat.

Smallest next prompt:

> Prepare the dev-runtime plan for outstanding live P08. First inspect existing development schema and legacy privacy-receipt provenance read-only, and locate/preserve the current independent journal and keys. Do not initialize an empty replacement journal, migrate, delete or start the privacy worker before presenting the exact required changes and their data effects. Keep account/questionnaire settings unchanged. After required preparation is authorized and browser access is actually available, execute outstanding P08 only on identified synthetic dev records with explicit test settings; retain all blocked/not-run criteria. Do not repeat passed installation checks.

No new product, account, data-access or dependency decision is made by this preflight. The0.8.5 local auth fix is retained; the independent advisory and P04/P09/provider/production gates remain open. Chat permission to bypass does not remove the browser tool security restriction.
