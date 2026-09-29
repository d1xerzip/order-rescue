import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import prisma, { authLockDb } from "../app/db.server";
import {
  activateShop,
  deactivateShop,
  receivePrivacy,
} from "../app/storage.server";
import { receiveOrderCreated } from "../app/order-webhook.server";
import {
  claimOrderJob,
  processOneOrderJob,
  purgeExpiredOrders,
} from "../app/order-jobs.server";
import { openOrder } from "../app/order-crypto.server";
import { fetchOrderSnapshot } from "../app/order-snapshot.server";

const domains: string[] = [];
const orderId = "gid://shopify/Order/900719925474099312345";
before(() => {
  assert.equal(process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB, "1");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1");
  process.env.ORDER_INGESTION_ENABLED = "1";
});
after(async () => {
  await prisma.lifecycleDelivery.deleteMany({
    where: { shopDomain: { in: domains } },
  });
  await prisma.privacyReceipt.deleteMany({
    where: { shopDomain: { in: domains } },
  });
  await prisma.shop.deleteMany({ where: { domain: { in: domains } } });
  await Promise.all([prisma.$disconnect(), authLockDb.$disconnect()]);
});
async function fixture() {
  const domain = `ingestion-${randomUUID()}.myshopify.com`;
  domains.push(domain);
  const shop = await activateShop(domain);
  await prisma.shop.update({
    where: { id: shop.id },
    data: { installedAt: new Date(Date.now() - 60_000) },
  });
  return shop;
}
function signed(
  domain: string,
  delivery = randomUUID(),
  body = JSON.stringify({
    admin_graphql_api_id: orderId,
    customer: { email: "never-store@example.invalid" },
  }),
  signature?: string,
) {
  return new Request("https://app.example.test/webhooks/orders/create", {
    method: "POST",
    body,
    headers: {
      "x-shopify-shop-domain": domain,
      "x-shopify-topic": "orders/create",
      "x-shopify-webhook-id": delivery,
      "x-shopify-hmac-sha256":
        signature ??
        createHmac("sha256", process.env.SHOPIFY_API_SECRET!)
          .update(Buffer.from(body))
          .digest("base64"),
    },
  });
}
function snapshot() {
  const stamp = new Date(Date.now() - 1000).toISOString();
  return {
    id: orderId,
    legacyResourceId: "900719925474099312345",
    createdAt: stamp,
    updatedAt: stamp,
    total: {
      available: true,
      value: { amount: "99999999999999999.0100", currencyCode: "CAD" },
    },
    cancelledAt: { available: true, value: null },
    lines: { available: true, value: [] },
  };
}
async function finishShop(shopId: string) {
  await prisma.orderJob.updateMany({
    where: { shopId },
    data: { status: "completed", leaseToken: null, leaseUntil: null },
  });
}

test("raw-byte HMAC rejects altered bytes and invalid signature before any durable receipt", async () => {
  const shop = await fixture();
  const body = '{ "admin_graphql_api_id": "' + orderId + '", "note": "é" }';
  const signature = createHmac("sha256", process.env.SHOPIFY_API_SECRET!)
    .update(body)
    .digest("base64");
  assert.equal(
    (
      await receiveOrderCreated(
        signed(shop.domain, randomUUID(), body + " ", signature),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await receiveOrderCreated(
        signed(shop.domain, randomUUID(), body, "invalid"),
      )
    ).status,
    401,
  );
  assert.equal(await prisma.orderJob.count({ where: { shopId: shop.id } }), 0);
  assert.equal(
    await prisma.orderSnapshot.count({ where: { shopId: shop.id } }),
    0,
  );
  assert.equal(
    (
      await receiveOrderCreated(
        signed(shop.domain, randomUUID(), body, signature),
      )
    ).status,
    200,
  );
  await finishShop(shop.id);
});

test("durable receipt precedes 200; concurrent/repeated delivery and changed delivery IDs have one snapshot effect", async () => {
  const shop = await fixture();
  const delivery = randomUUID();
  const responses = await Promise.all(
    Array.from({ length: 4 }, () =>
      receiveOrderCreated(signed(shop.domain, delivery)),
    ),
  );
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200, 200, 200],
  );
  const job = await prisma.orderJob.findFirstOrThrow({
    where: { shopId: shop.id },
  });
  assert.equal(job.status, "pending");
  const eligibility = await prisma.$queryRaw<
    Array<{ due: boolean; unexpired: boolean; timezone: string }>
  >`SELECT "availableAt" <= (${new Date()}::timestamptz AT TIME ZONE 'UTC') AS due, "expiresAt" > (${new Date()}::timestamptz AT TIME ZONE 'UTC') AS unexpired, current_setting('TimeZone') AS timezone FROM "OrderJob" WHERE id = ${job.id}`;
  assert.equal(eligibility[0].due, true, JSON.stringify(eligibility));
  assert.equal(await prisma.orderJob.count({ where: { shopId: shop.id } }), 1);
  assert.equal(JSON.stringify(job).includes("never-store"), false);
  const value = snapshot();
  const results = await Promise.all([
    processOneOrderJob(async () => value),
    processOneOrderJob(async () => value),
  ]);
  assert.equal(results.filter((r) => r.processed).length, 1);
  assert.equal((await receiveOrderCreated(signed(shop.domain))).status, 200);
  assert.equal(
    (await processOneOrderJob(async () => value)).status,
    "completed",
  );
  const rows = await prisma.orderSnapshot.findMany({
    where: { shopId: shop.id },
  });
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].encryptedSnapshot.includes(value.total.value.amount),
    false,
  );
  assert.deepEqual(
    JSON.parse(openOrder(rows[0].encryptedSnapshot, `${shop.id}:1:${orderId}`)),
    value,
  );
  assert.throws(
    () => openOrder(rows[0].encryptedSnapshot, `foreign:1:${orderId}`),
    /DECRYPTION_FAILED/,
  );
});

test("crash after committed order write is reclaimed and completes without duplicate effect", async () => {
  const shop = await fixture();
  await receiveOrderCreated(signed(shop.domain));
  const value = snapshot();
  await assert.rejects(
    processOneOrderJob(async () => value, {
      afterWrite: () => {
        throw new Error("SIMULATED_PROCESS_CRASH");
      },
    }),
    /SIMULATED_PROCESS_CRASH/,
  );
  const before = await prisma.orderSnapshot.findFirstOrThrow({
    where: { shopId: shop.id },
  });
  const job = await prisma.orderJob.findFirstOrThrow({
    where: { shopId: shop.id },
  });
  assert.equal(job.status, "processing");
  assert.equal((await processOneOrderJob(async () => value)).processed, false);
  assert.equal(
    (
      await processOneOrderJob(async () => value, {
        now: new Date(job.leaseUntil!.getTime() + 1),
      })
    ).status,
    "completed",
  );
  assert.equal(
    await prisma.orderSnapshot.count({ where: { shopId: shop.id } }),
    1,
  );
  assert.deepEqual(
    await prisma.orderSnapshot.findFirst({ where: { shopId: shop.id } }),
    before,
  );
});

test("expired lease fences stale worker and retry exhausts safely without raw errors", async () => {
  const shop = await fixture();
  await receiveOrderCreated(signed(shop.domain));
  const value = snapshot();
  const result = await processOneOrderJob(async () => {
    await prisma.orderJob.updateMany({
      where: { shopId: shop.id },
      data: { leaseUntil: new Date(0) },
    });
    return value;
  });
  assert.notEqual(result.status, "completed");
  assert.equal(
    await prisma.orderSnapshot.count({ where: { shopId: shop.id } }),
    0,
  );
  const retry = await processOneOrderJob(async () => {
    throw new Error("sensitive upstream payload");
  });
  assert.equal(retry.status, "retry");
  await prisma.orderJob.updateMany({
    where: { shopId: shop.id },
    data: { attempts: 4, availableAt: new Date(0) },
  });
  assert.equal(
    (
      await processOneOrderJob(async () => {
        throw new Error("secret");
      })
    ).status,
    "failed",
  );
  const failed = await prisma.orderJob.findFirstOrThrow({
    where: { shopId: shop.id },
  });
  assert.equal(failed.errorCode, "ORDER_FETCH_FAILED");
  assert.equal(await claimOrderJob(), null);
});

test("uninstall during fetch fences snapshot commit and old generation never claims", async () => {
  const shop = await fixture();
  await receiveOrderCreated(signed(shop.domain));
  assert.equal(
    (
      await processOneOrderJob(async () => {
        await deactivateShop(shop.domain, randomUUID());
        return snapshot();
      })
    ).status,
    "failed",
  );
  assert.equal(
    await prisma.orderSnapshot.count({ where: { shopId: shop.id } }),
    0,
  );
  assert.equal((await receiveOrderCreated(signed(shop.domain))).status, 503);
  await activateShop(shop.domain);
  assert.equal(await claimOrderJob(), null);
});

test("outside monitoring window creates no snapshot and retention purges expired data", async () => {
  const shop = await fixture();
  await receiveOrderCreated(signed(shop.domain));
  const value = snapshot();
  value.createdAt = new Date(Date.now() - 31 * 86_400_000).toISOString();
  assert.equal((await processOneOrderJob(async () => value)).status, "failed");
  assert.equal(
    await prisma.orderSnapshot.count({ where: { shopId: shop.id } }),
    0,
  );
  await prisma.orderJob.updateMany({
    where: { shopId: shop.id },
    data: { expiresAt: new Date(0) },
  });
  await purgeExpiredOrders();
  assert.equal(await prisma.orderJob.count({ where: { shopId: shop.id } }), 0);
});

test("foreign-shop signed routing cannot persist an order unavailable to that shop token", async () => {
  const shop = await fixture();
  await receiveOrderCreated(signed(shop.domain));
  const result = await processOneOrderJob(async (job, tenant) =>
    fetchOrderSnapshot(
      async (query) =>
        Response.json(
          {
            data: query.includes("P03OrderAuthority")
              ? {
                  shop: {
                    id: "gid://shopify/Shop/2",
                    myshopifyDomain: tenant.domain,
                  },
                  currentAppInstallation: {
                    accessScopes: [{ handle: "read_orders" }],
                  },
                }
              : { order: null },
          },
          { headers: { "X-Shopify-API-Version": "2026-07" } },
        ),
      job.orderId,
      { shopifyId: "gid://shopify/Shop/2", domain: tenant.domain },
    ),
  );
  assert.equal(result.status, "retry");
  assert.equal(
    await prisma.orderSnapshot.count({ where: { shopId: shop.id } }),
    0,
  );
  await finishShop(shop.id);
});

test("pending privacy redaction prevents a worker from recreating protected order data", async () => {
  const shop = await fixture();
  await receiveOrderCreated(signed(shop.domain));
  const result = await processOneOrderJob(async () => {
    await receivePrivacy(shop.domain, "customers/redact", randomUUID(), {
      orders_to_redact: ["900719925474099312345"],
    });
    return snapshot();
  });
  assert.equal(result.status, "failed");
  assert.equal(
    await prisma.orderSnapshot.count({ where: { shopId: shop.id } }),
    0,
  );
});

test("unavailable real database connection returns 503, never durable-success acknowledgment", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import {createHmac} from 'node:crypto';
    import {receiveOrderCreated} from './app/order-webhook.server.ts';
    import db,{authLockDb} from './app/db.server.ts';
    const body=JSON.stringify({admin_graphql_api_id:'${orderId}'});
    const response=await receiveOrderCreated(new Request('https://app.example.test/webhooks/orders/create',{method:'POST',body,headers:{'x-shopify-topic':'orders/create','x-shopify-shop-domain':'outage.myshopify.com','x-shopify-webhook-id':'outage','x-shopify-hmac-sha256':createHmac('sha256',process.env.SHOPIFY_API_SECRET).update(body).digest('base64')}}));
    if(response.status!==503) process.exitCode=1;
    await Promise.all([db.$disconnect(),authLockDb.$disconnect()]);
  `,
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL:
          "postgresql://synthetic:synthetic@127.0.0.1:1/unavailable?connect_timeout=1",
      },
      windowsHide: true,
      stdio: "pipe",
      timeout: 15000,
    },
  );
  assert.equal(child.status, 0, "Outage subprocess must return 503");
});

test("another PostgreSQL connection holding a row lock cannot double-claim the job", async () => {
  const shop = await fixture();
  await receiveOrderCreated(signed(shop.domain));
  const job = await prisma.orderJob.findFirstOrThrow({
    where: { shopId: shop.id },
  });
  let unlock!: () => void;
  let locked!: () => void;
  const barrier = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const release = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const holder = authLockDb.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OrderJob" WHERE id = ${job.id} FOR UPDATE`;
    locked();
    await release;
  });
  await barrier;
  try {
    assert.equal(await claimOrderJob(), null);
  } finally {
    unlock();
    await holder;
  }
  const claimed = await claimOrderJob();
  assert.equal(claimed?.id, job.id);
  assert.equal(await claimOrderJob(), null);
  await finishShop(shop.id);
});
