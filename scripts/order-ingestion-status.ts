// Read-only local evidence. No Shopify request and no raw IDs/payload output.
import prisma, { authLockDb } from "../app/db.server";
import { openOrder } from "../app/order-crypto.server";
import { validateShopDomain } from "../app/storage.server";

const database = new URL(process.env.DATABASE_URL || "");
if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname))
  throw new Error("LOCAL_DATABASE_REQUIRED");
const domains = process.argv.slice(2).map(validateShopDomain);
if (!domains.length) throw new Error("EXPLICIT_DEV_SHOPS_REQUIRED");
try {
  for (let index = 0; index < domains.length; index++) {
    const shop = await prisma.shop.findUnique({
      where: { domain: domains[index] },
    });
    if (!shop) {
      console.log(
        JSON.stringify({ store: index + 1, status: "NOT_INSTALLED" }),
      );
      continue;
    }
    const where = { shopId: shop.id, generation: shop.generation };
    const jobs = await prisma.orderJob.groupBy({
      by: ["status"],
      where,
      _count: true,
    });
    const snapshots = await prisma.orderSnapshot.findMany({
      where: { ...where, expiresAt: { gt: new Date() } },
    });
    let matchingCompleted = 0;
    let decryptable = 0;
    for (const snapshot of snapshots) {
      const value = JSON.parse(
        openOrder(
          snapshot.encryptedSnapshot,
          `${shop.id}:${shop.generation}:${snapshot.orderId}`,
        ),
      );
      if (
        value.id === snapshot.orderId &&
        typeof value.legacyResourceId === "string"
      )
        decryptable++;
      if (
        await prisma.orderJob.count({
          where: { ...where, orderId: snapshot.orderId, status: "completed" },
        })
      )
        matchingCompleted++;
    }
    console.log(
      JSON.stringify({
        store: index + 1,
        active: shop.active,
        generation: shop.generation,
        jobs: Object.fromEntries(
          jobs.map((group) => [group.status, group._count]),
        ),
        snapshots: snapshots.length,
        decryptable,
        matchingCompleted,
        // These counts alone cannot prove Shopify origin versus a signed fixture.
        liveDeliveryProven: false,
      }),
    );
  }
} catch {
  console.error("INGESTION_STATUS_UNAVAILABLE");
  process.exitCode = 1;
} finally {
  await Promise.all([prisma.$disconnect(), authLockDb.$disconnect()]);
}
