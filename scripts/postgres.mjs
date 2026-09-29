import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
export async function localPostgres({ testing = false } = {}) {
  const dir = resolve(testing ? ".local/test" : ".local");
  mkdirSync(dir, { recursive: true });
  const configPath = resolve(dir, "database.json");
  let config;
  if (existsSync(configPath))
    config = JSON.parse(readFileSync(configPath, "utf8"));
  else {
    config = {
      user: "rescue_local",
      password: randomBytes(32).toString("hex"),
      port: testing ? 55433 : 55432,
    };
    writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  }
  const databaseDir = resolve(dir, "postgres");
  const pg = new EmbeddedPostgres({
    databaseDir,
    ...config,
    authMethod: "scram-sha-256",
    persistent: true,
    createPostgresUser: false,
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: () => {},
  });
  if (!existsSync(resolve(databaseDir, "PG_VERSION"))) await pg.initialise();
  await pg.start();
  return {
    pg,
    url: (name) =>
      `postgresql://${config.user}:${config.password}@127.0.0.1:${config.port}/${name}?schema=public`,
  };
}
