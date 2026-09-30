# P10B isolated backup, restore and application rollback

2026-09-30. A real PostgreSQL custom-format backup and restore was executed against two distinct disposable synthetic databases. [Machine-readable measurements](evidence/p10b/restore.json) bind the final executed runner and fixture by SHA-256, plus the candidate package version and fingerprints for application source, Prisma schema and dependency manifests. The runner checks those candidate files remain unchanged during its run. Source hashes normalize CRLF to LF and final whitespace to one newline. No merchant database, account settings, live order or existing privacy journal was changed.

## Environment and reproducibility

Run from the repository root after installing the locked project dependencies and generating the Prisma client:

```powershell
node scripts/reliability-restore.mjs
```

The runner owns a new `.local/p10b-restore-<timestamp>/postgres` cluster on **127.0.0.1:55435**. A port-availability check fails if another process is listening. It never loads `.env.local`, uses dev55432/shared tests55433/load55434, reuses an existing cluster, or accepts a database URL argument. Source and target names start with `rescue_restore_source_` and `rescue_restore_target_`; the fixture independently checks loopback/port/name/test-mode guards. All fixture network fetches throw. The cluster is stopped in `finally`; private files remain for investigation, including a current independent journal and key file outside the database dump. Deleting that journal is not a recovery procedure.

The installed embedded server package does **not** contain `pg_dump` or `pg_restore`. Initial attempts failed with `ENOENT` before a backup was made; these are tooling failures, not successful restores. Portable official PostgreSQL client binaries were then obtained without running an installer, registering a service or changing PATH. The runner expects these under `.local/p10b-restore-tools`, or an explicitly provided local `P10B_PG_BIN` directory. It checks both binaries exist before starting the cluster.

Tooling provenance checked2026-09-30:

- [PostgreSQL Windows downloads](https://www.postgresql.org/download/windows/) links to EDB and explicitly provides portable ZIP binaries.
- [EDB binaries](https://www.enterprisedb.com/download-postgresql-binaries) linked Windows18.6 to `https://sbp.enterprisedb.com/getfile.jsp?fileid=1260566`, observed redirect to [postgresql-18.6-4-windows-x64-binaries.zip](https://get.enterprisedb.com/postgresql/postgresql-18.6-4-windows-x64-binaries.zip).
- Downloaded ZIP SHA-256: `1df55002afe95b945d934c078b13e82c1603fa546731e511d068aa983b4ead28`; both tools report18.6. This is the observed download hash, not a claim of independently published checksum verification. Only `pg_dump.exe`, `pg_restore.exe` and their `pgsql/bin/*.dll` dependencies were extracted into the private tooling directory. Binaries/ZIPs/keys/dumps are excluded from publication.

The runner executes these stages with generated synthetic credentials supplied in environment variables, never printed in the commands or public evidence:

```text
git rev-parse v0.8.1^{commit}
git archive --format=tar --output=<private-baseline.tar> v0.8.1
tar -xf <private-baseline.tar> -C <private-baseline-source>
node node_modules/prisma/build/index.js migrate deploy
node --import tsx scripts/reliability-restore-fixture.ts seed
pg_dump --host=127.0.0.1 --port=55435 --username=rescue_restore --no-password --format=custom --no-owner --file=<private-dump> <source-db>
node --import tsx scripts/reliability-restore-fixture.ts delete
pg_restore --host=127.0.0.1 --port=55435 --username=rescue_restore --no-password --exit-on-error --no-owner --no-privileges --dbname=<distinct-target-db> <private-dump>
node --import tsx scripts/reliability-restore-fixture.ts compare
node --import tsx scripts/reliability-restore-fixture.ts rollback
```

The Git commands first resolve tagv0.8.1 in the current checkout, so a public repository clone containing that tag can run the test. Only if that lookup fails, the developer workspace's existing `.local/public-release/publish` checkout is used as a read-only fallback. If neither has the tag, the runner fails; it never fetches or mutates Git history automatically. These commands do not switch branches or overwrite checkout files. Rollback imports archived v0.8.1 application server modules via `RELIABILITY_SOURCE_ROOT`; current installed dependencies and generated Prisma client are shared. It is a **server-source compatibility rehearsal**, not a historical container/dependency rollback, browser test or HTTP-authentication test.

## Predetermined records and checks

Two fictional shops receive explicit CAD100.00/value and5/per-line settings. Three exact normalized snapshots use CAD100.01 and quantity6, creating six rule evaluations and six exceptions. One retained exception is ignored with actor/reason/time/version history, producing seven history rows. A second event for the order to be erased remains queued at backup time. The same Shopify order ID belongs to a different shop as a tenant-isolation control.

| Stage | Required observation | Result |
|---|---|---|
| Seed | Decrypted snapshot equals every supplied ID, amount, currency, timestamp and line field; no defaults | PASS |
| Backup→distinct restore | All rows and columns in nine selected tables equal the pre-backup records, including encrypted bytes, IDs, versions, settings and decision history | PASS |
| Erasure after backup | Authentic original-byte signed synthetic `customers/redact` accepted; worker completes; source has two retained snapshots; independent journal has one marker | PASS |
| Before restored sweep | Old deleted rows exist in restored DB while its DB ledger has no marker; current journal blocks read and new intake | PASS |
| Restored queued event | Ordinary worker does not fetch an erased order even though the older backup contains queued work | PASS |
| Sweep using baseline source | Deleted order/jobs removed; four evaluations/four exceptions/five histories retained; one DB marker recreated; other shop with same order ID untouched | PASS |
| Baseline application writes | Read settings/history, increment explicit quantity settings revision, ingest a new synthetic order with only value match, Resolve it, deny foreign-shop server-function access | PASS |
| Journal custody through restore | Journal content hash unchanged from completed source deletion through restore/rollback | PASS |

The nine compared tables are `Shop`, `OrderSnapshot`, `RuleSetting`, `RuleEvaluation`, `ExceptionRecord`, `ExceptionHistory`, `OrderJob`, `OrderSyncState` and `PrivacyDeletion`. Comparisons assert full sorted rows, not just counts. The last two are intentionally empty before the backup; the fixture does not claim sync checkpoint recovery or credential coverage from this restore dataset. Other P10B tests cover synchronization separately.

## Rollback and operational limits

No schema downmigration was run. The archived baseline at tagv0.8.1 operates on the schema produced by the current migration directory. If later changes break that compatibility, do not attempt destructive downmigration: keep ordinary access/workers offline, restore the last compatible database into an isolated target, replay the **current independently preserved** privacy journal, apply a compatible forward fix and verify lifecycle/tenant state before enabling access. This is a proposed operational procedure beyond the exercised source compatibility paths.

This test supports local recovery of the small synthetic fixture only. It does not establish production RTO/RPO, backup scheduling/retention, encryption of the backup volume, remote provider restoration, journal external durability/rollback protection, current Shopify installation/scope reconciliation, or a full deployment rollback. Application fields are encrypted, but routing metadata remains present in the private dump; the dump itself was not additionally encrypted by this test. These controls require separate evidence.

P08/P10A real Shopify workflow and P09 registration/development runtime/provider/export/legal blockers remain open. No deletion or restore was performed on development-store or live merchant data. A locally passing restore cannot close those gates.
