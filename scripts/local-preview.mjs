import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
if (!existsSync(".env.local")) throw new Error("Run npm run db:local first");
process.loadEnvFile(".env.local");
const child = spawn(
  process.execPath,
  ["node_modules/@react-router/dev/bin.js", "dev", "--host", "127.0.0.1"],
  {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, RUN_MODE: "local-preview", PORT: "3000" },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
