import { localPostgres } from "./postgres.mjs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
const { pg, url } = await localPostgres({ testing: true });
const name = `rescue_test_${Date.now()}`;
const run = (args, env) =>
  new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, {
      stdio: "inherit",
      windowsHide: true,
      env,
    });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`CHECK_EXIT_${code}`)),
    );
  });
try {
  await pg.createDatabase(name);
  const env = {
    ...process.env,
    DATABASE_URL: url(name) + "&connection_limit=1",
    SESSION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    ORDER_RESCUE_DISPOSABLE_TEST_DB: "1",
    SHOPIFY_API_KEY: "synthetic-api-key",
    SHOPIFY_API_SECRET: "synthetic-test-secret-not-real",
    SHOPIFY_APP_URL: "https://app.example.test",
    NODE_ENV: "test",
    RUN_MODE: "test",
  };
  await run(["node_modules/prisma/build/index.js", "migrate", "deploy"], env);
  await run(
    [
      "node_modules/tsx/dist/cli.mjs",
      "--test",
      "--test-concurrency=1",
      ...readdirSync("tests")
        .filter((n) => n.endsWith(".test.ts"))
        .map((n) => `tests/${n}`),
    ],
    env,
  );
} finally {
  await pg.stop();
}
