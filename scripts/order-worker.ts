import { setTimeout as delay } from "node:timers/promises";
import prisma, { authLockDb } from "../app/db.server";
import { shopOrderGraphql } from "../app/order-runtime.server";
import { advanceOrderSync } from "../app/order-sync.server";
import {
  processOneOrderJob,
  purgeExpiredOrders,
} from "../app/order-jobs.server";
import { fetchOrderSnapshot, fetchOrderPage } from "../app/order-snapshot.server";

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
let nextShop = 0;
try {
  do {
    try {
      if (Date.now() - lastPurge > 60_000) {
        await purgeExpiredOrders();
        lastPurge = Date.now();
      }
      const shops = await prisma.shop.findMany({ where: { active: true, jobsEnabled: true }, orderBy: { id: "asc" } });
      if (shops.length) {
        const target = shops[nextShop++ % shops.length];
        await advanceOrderSync(target.id, async ({ shop, windowStart, windowEnd, cursor }) => {
          if (!shop.shopifyId) throw new Error("SHOP_IDENTITY_UNAVAILABLE");
          return fetchOrderPage(shopOrderGraphql(shop.domain, shop.generation),
            { shopifyId: shop.shopifyId, domain: shop.domain },
            { from: windowStart, to: windowEnd, after: cursor });
        });
      }
      const result = await processOneOrderJob(async (job, shop) => {
        if (!shop.shopifyId) throw new Error("SHOP_IDENTITY_UNAVAILABLE");
        return fetchOrderSnapshot(
          shopOrderGraphql(shop.domain, job.generation),
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
