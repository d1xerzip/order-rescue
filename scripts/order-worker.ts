import { setTimeout as delay } from "node:timers/promises";
import prisma, { authLockDb } from "../app/db.server";
import { authenticatedBackground } from "../app/auth.server";
import {
  processOneOrderJob,
  purgeExpiredOrders,
} from "../app/order-jobs.server";
import { fetchOrderSnapshot } from "../app/order-snapshot.server";

if (process.env.ORDER_INGESTION_ENABLED !== "1")
  throw new Error("ORDER_INGESTION_DISABLED");
let stopped = false;
process.once("SIGINT", () => {
  stopped = true;
});
process.once("SIGTERM", () => {
  stopped = true;
});
let lastPurge = 0;
try {
  do {
    try {
      if (Date.now() - lastPurge > 60_000) {
        await purgeExpiredOrders();
        lastPurge = Date.now();
      }
      const result = await processOneOrderJob(async (job, shop) => {
        if (!shop.shopifyId) throw new Error("SHOP_IDENTITY_UNAVAILABLE");
        const { admin } = await authenticatedBackground(
          shop.domain,
          job.generation,
        );
        return fetchOrderSnapshot(
          (query, options) => admin.graphql(query, options),
          job.orderId,
          { shopifyId: shop.shopifyId, domain: shop.domain },
        );
      });
      // Deliberately omit job/order/shop identifiers and SDK exception text.
      if (result.processed)
        console.log(
          JSON.stringify({ operation: "order_job", status: result.status }),
        );
      if (!result.processed && !process.argv.includes("--once"))
        await delay(1000);
    } catch {
      console.error("ORDER_WORKER_UNAVAILABLE");
      if (!process.argv.includes("--once")) await delay(5000);
      else process.exitCode = 1;
    }
  } while (!stopped && !process.argv.includes("--once"));
} finally {
  await Promise.all([prisma.$disconnect(), authLockDb.$disconnect()]);
}
