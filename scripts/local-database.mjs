import { localPostgres } from "./postgres.mjs";
import { writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
const { pg, url } = await localPostgres();
const client = pg.getPgClient("postgres", "127.0.0.1");
await client.connect();
const found = await client.query(
  "SELECT 1 FROM pg_database WHERE datname = 'order_rescue_local'",
);
await client.end();
if (!found.rowCount) await pg.createDatabase("order_rescue_local");
if (!existsSync(".env.local"))
  writeFileSync(
    ".env.local",
    `DATABASE_URL=${url("order_rescue_local")}\nSESSION_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}\n`,
    { mode: 0o600 },
  );
console.log(
  "Local PostgreSQL ready at 127.0.0.1:55432. Credentials stored in ignored .env.local; keep this process open.",
);
const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
setInterval(() => {}, 60000);
