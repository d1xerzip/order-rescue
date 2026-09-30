import { setTimeout as delay } from "node:timers/promises";
import prisma, { authLockDb } from "../app/db.server";
import { applyPrivacyJournal, processOnePrivacyJob, purgePrivacy } from "../app/privacy.server";

// Deliberately independent of ORDER_INGESTION_ENABLED and active sessions.
let stopped = false;
process.once("SIGINT", () => { stopped = true; });
process.once("SIGTERM", () => { stopped = true; });
try {
  await applyPrivacyJournal();
  do {
    try {
      await purgePrivacy();
      const result = await processOnePrivacyJob();
      if (result.processed) console.log(JSON.stringify({ operation: "privacy_job", status: result.status }));
      if (!result.processed && !process.argv.includes("--once")) await delay(1000);
    } catch {
      console.error("PRIVACY_WORKER_UNAVAILABLE");
      process.exitCode = 1;
      if (!process.argv.includes("--once")) await delay(5000);
    }
  } while (!stopped && !process.argv.includes("--once"));
} finally { await Promise.all([prisma.$disconnect(), authLockDb.$disconnect()]); }
