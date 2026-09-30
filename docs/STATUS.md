# Current status — development runtime restored; manual P08 in progress

Version **0.8.7**, branch `codex/dev-runtime-recovery`, 2026-09-30. Application/test/schema/dependency source unchanged from public merge a9d019df0eb1f310140f69b0c464710ba2679fdf. This operational recovery supersedes the offline preflight, preserved in STATUS.pre-runtime-recovery.md.

## Changed
Restored existing PostgreSQL and linked dev preview. After history review and conditional owner authorization, provisioned the first independent dev privacy key/journal without replacing prior credentials. Applied the existing additive P09 migration and started both workers. [Recovery evidence](DEV-RUNTIME-RECOVERY.md) records preservation, actual commands and startup corrections.

## Verified
Four previous migration checksums matched; existing session key authenticated all four stored credential fields. Only a known empty P02 synthetic data request was pending; no unattributed receipt or pending redaction. Encrypted logical backup created and authenticated roundtrip checked, without claiming a restore. Immediately after migration, all original columns/rows across 13 existing non-migration tables matched their pre-migration fingerprints. Both health endpoints returned 200 over loopback and HTTPS; readiness explicitly says configured_not_verified. Workers running; one synthetic privacy request and two ordinary jobs completed at observation. Current selected shop is active, has an encrypted session with only read_orders and initially has no saved rule settings.

Owner manual P08 step 1: interface opened in the correct shop with no visible error. This is OWNER-REPORTED, not an automated browser/Console result. Step 2 (explicit value-rule settings and reload) is pending. No passed installation cycle repeated.

## Not run / blockers
Full current P08 order/inbox/evidence/action/reload/settings/order-link/foreign-ID/Console workflow and screenshots remain incomplete. Current hydration check NOT RUN; browser automation denial unchanged and no bypass attempted. No actual dev deletion/restore test, account/questionnaire change or deployment. Full suite/build not repeated for this operational-only change; 240-test PASS remains v0.8.5 evidence.

Local dev migration, first journal provisioning, receipt provenance and worker startup are now completed, superseding their former NOT RUN status. Actual privacy platform registration/delivery, production PCD, legal/support identity, secure export handoff, provider/TLS/volume/log/backups and independent production journal custody remain open. Preserve P04 remaining live cases and P08–P10 acceptance gates. Auth race remains fixed by v0.8.5; the independent deepmerge advisory remains OPEN.

## Decision / next
**Runtime ready for owner-operated P08; release NOT READY.** Continue one manual step at a time, using explicit dev-only synthetic settings. Do not reseed thresholds, reset data, regenerate keys/journal or repeat installation. See [NEXT.md](NEXT.md).
