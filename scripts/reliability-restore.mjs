import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { createServer } from "node:net";
import EmbeddedPostgres from "embedded-postgres";

// Dedicated loopback cluster; no imported environment file, shared cluster or live DB.
if (process.argv.length !== 2) throw new Error("RESTORE_ARGUMENTS_FORBIDDEN");
const root = process.cwd(), started = performance.now(), stamp = Date.now();
const dir = resolve(`.local/p10b-restore-${stamp}`), port = 55435;
mkdirSync(resolve(".local"), { recursive: true });
mkdirSync(dir, { recursive: false });
const probe = createServer();
await new Promise((ok, fail) => { probe.once("error", fail); probe.listen(port, "127.0.0.1", ok); });
await new Promise(resolve => probe.close(resolve));
const sourceDb = `rescue_restore_source_${stamp}`, targetDb = `rescue_restore_target_${stamp}`;
assert.notEqual(sourceDb, targetDb);
const password = randomBytes(32).toString("hex"), user = "rescue_restore";
const journal = resolve(dir, "current-independent-privacy.jsonl"), dump = resolve(dir, "database.dump"), expected = resolve(dir, "expected-private.json");
const baseline = resolve(dir, "baseline-v0.8.1");
mkdirSync(baseline); writeFileSync(journal, "", { flag: "wx", mode: 0o600 });
const keys = { SESSION_ENCRYPTION_KEY: randomBytes(32).toString("base64"), PRIVACY_LEDGER_KEY: randomBytes(32).toString("base64") };
writeFileSync(resolve(dir, "keys-private.json"), JSON.stringify(keys), { mode: 0o600, flag: "wx" });
const env = { ...process.env, ...keys, PRIVACY_JOURNAL_PATH: journal,
  SHOPIFY_API_KEY: "synthetic-api-key", SHOPIFY_API_SECRET: "synthetic-test-secret-not-real", SHOPIFY_APP_URL: "https://app.example.test",
  NODE_ENV: "test", RUN_MODE: "test", ORDER_RESCUE_DISPOSABLE_TEST_DB: "1", RELIABILITY_SOURCE_ROOT: root, RELIABILITY_EXPECTED_PATH: expected };
const dbEnv = name => ({ ...env, DATABASE_URL: `postgresql://${user}:${password}@127.0.0.1:${port}/${name}?schema=public&connection_limit=1` });
let logIndex = 0;
async function run(command, args, childEnv = env, cwd = root) {
  const log = resolve(dir, `command-${++logIndex}.log`);
  return new Promise((ok, fail) => {
    const p = spawn(command, args, { env: childEnv, cwd, windowsHide: true, stdio: "pipe", timeout: 120_000 });
    let output = "";
    p.stdout.on("data", b => { output += b.toString(); }); p.stderr.on("data", b => { output += b.toString(); });
    p.on("error", fail); p.on("exit", code => { writeFileSync(log, output, { mode: 0o600 }); code === 0 ? ok(output.trim()) : fail(new Error(`RESTORE_COMMAND_${logIndex}_EXIT_${code}`)); });
  });
}
const pg = new EmbeddedPostgres({ databaseDir: resolve(dir, "postgres"), user, password, port,
  authMethod: "scram-sha-256", persistent: true, createPostgresUser: false, postgresFlags: ["-h", "127.0.0.1"], onLog: () => {}, onError: () => {} });
const binaryDir = resolve(process.env.P10B_PG_BIN || `.local/p10b-restore-tools`);
const binary = name => resolve(binaryDir, name + (process.platform === "win32" ? ".exe" : ""));
if (!existsSync(binary("pg_dump")) || !existsSync(binary("pg_restore"))) throw new Error("POSTGRES_CLIENT_BINARIES_REQUIRED_SEE_P10B_RESTORE");
const sqlEnv = { ...env, PGPASSWORD: password };
const common = ["--host=127.0.0.1", `--port=${port}`, `--username=${user}`, "--no-password"];
const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex");
const sourceFiles = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = resolve(dir, entry.name);
  return entry.isDirectory() ? sourceFiles(file) : /\.(ts|tsx|css)$/.test(entry.name) ? [file] : [];
});
const sourceFingerprint = () => Object.fromEntries([...sourceFiles(resolve("app")), resolve("prisma/schema.prisma"), resolve("package.json"), resolve("package-lock.json")]
  .sort().map(file => [relative(root, file).replaceAll("\\", "/"), createHash("sha256").update(readFileSync(file, "utf8").replaceAll("\r\n", "\n").trimEnd() + "\n").digest("hex")]));
let running = false;
try {
  let publicRepo = root, baselineCommit;
  try { baselineCommit = await run("git", ["rev-parse", "--verify", "v0.8.1^{commit}"], env, publicRepo); }
  catch {
    publicRepo = resolve(".local/public-release/publish");
    if (!existsSync(publicRepo)) throw new Error("BASELINE_TAG_V0_8_1_REQUIRED_IN_CURRENT_REPOSITORY");
    baselineCommit = await run("git", ["rev-parse", "--verify", "v0.8.1^{commit}"], env, publicRepo);
  }
  const candidateVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
  const candidateSourceSha256 = sourceFingerprint();
  const tarFile = resolve(dir, "baseline.tar");
  await run("git", ["archive", "--format=tar", `--output=${tarFile}`, "v0.8.1"], env, publicRepo);
  await run("tar", ["-xf", tarFile, "-C", baseline]);
  symlinkSync(resolve("node_modules"), resolve(baseline, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  await pg.initialise(); await pg.start(); running = true;
  await pg.createDatabase(sourceDb); await pg.createDatabase(targetDb);
  const client = pg.getPgClient(sourceDb, "127.0.0.1");
  await client.connect();
  const serverVersion = (await client.query("SHOW server_version")).rows[0].server_version;
  await client.end();
  const current = dbEnv(sourceDb), restored = dbEnv(targetDb);
  const fixture = mode => ["--import", "tsx", "scripts/reliability-restore-fixture.ts", mode];
  await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], current);
  await run(process.execPath, fixture("seed"), current);
  const dumpStarted = performance.now();
  await run(binary("pg_dump"), [...common, "--format=custom", "--no-owner", `--file=${dump}`, sourceDb], sqlEnv);
  const dumpMs = performance.now() - dumpStarted;
  await run(process.execPath, fixture("delete"), current);
  const journalHash = hash(journal);
  const restoreStarted = performance.now();
  await run(binary("pg_restore"), [...common, "--exit-on-error", "--no-owner", "--no-privileges", `--dbname=${targetDb}`, dump], sqlEnv);
  const restoreMs = performance.now() - restoreStarted;
  assert.equal(hash(journal), journalHash);
  await run(process.execPath, fixture("compare"), restored);
  await run(process.execPath, fixture("rollback"), { ...restored, RELIABILITY_SOURCE_ROOT: baseline });
  assert.equal(hash(journal), journalHash);
  assert.deepEqual(sourceFingerprint(), candidateSourceSha256, "Candidate runtime source changed during restore rehearsal");
  const pgVersion = await run(binary("pg_dump"), ["--version"]);
  const evidence = { status: "PASS", recordedAt: new Date().toISOString(), node: process.version, platform: process.platform, postgres: { serverVersion, clientVersion: pgVersion },
    scriptsSha256: { runner: hash("scripts/reliability-restore.mjs"), fixture: hash("scripts/reliability-restore-fixture.ts") },
    candidateVersion, candidateSourceSha256, sourceHashNormalization: "UTF-8, CRLF to LF, trim trailing file whitespace then one newline",
    baselineTag: "v0.8.1", baselineCommit, database: "dedicated synthetic source and distinct restored target on loopback port 55435",
    backup: { format: "PostgreSQL custom", bytes: statSync(dump).size, sha256: hash(dump), durationMs: Math.round(dumpMs) },
    restore: { durationMs: Math.round(restoreMs), exactComparedTables: 9, snapshots: 3, settings: 4, evaluations: 6, exceptions: 6, history: 7 },
    deletion: { afterBackup: true, independentJournalPreserved: true, rawRestoredRowsCompared: true, blockedBeforeSweep: true, fetchSkipped: true,
      erasedSnapshotAndJobsRemoved: true, foreignTenantRetained: true, journalMarkers: 1 },
    rollback: { serverSourceTag: "v0.8.1", schema: "current migrations", currentInstalledDependencies: true, settingsReadWrite: true, workerReadWrite: true,
      exceptionReadAction: true, foreignServerFunctionDenied: true, privacyReplay: true, browserOrHttpAuth: "NOT RUN", downMigration: "NOT RUN; not attempted" },
    durationMs: Math.round(performance.now() - started), limitations: ["Synthetic local fixture, not provider backup or live merchant capacity", "Current dependencies shared with baseline source; not a historic binary/container deployment", "Independent journal external durability/rollback protection remains unverified"] };
  mkdirSync("docs/evidence/p10b", { recursive: true });
  writeFileSync("docs/evidence/p10b/restore.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally { if (running) await pg.stop(); }
