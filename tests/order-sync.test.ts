import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import prisma, { authLockDb } from "../app/db.server";
import { activateShop } from "../app/storage.server";
import { advanceOrderSync, getOrderSyncStatus, resetOrderSync, type SyncPage } from "../app/order-sync.server";
import { acceptOrderJob, processOneOrderJob } from "../app/order-jobs.server";
import { openOrder } from "../app/order-crypto.server";
import { OrderApiError } from "../app/order-api.server";

const domains: string[] = [];
const now = new Date();
const later = (ms: number) => new Date(now.getTime() + ms);
before(() => {
  assert.equal(process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB, "1");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1");
});
after(async () => {
  await prisma.shop.deleteMany({ where: { domain: { in: domains } } });
  await Promise.all([prisma.$disconnect(), authLockDb.$disconnect()]);
});
async function fixture() {
  const domain = `sync-${randomUUID()}.myshopify.com`;
  domains.push(domain);
  const shop = await activateShop(domain);
  return prisma.shop.update({ where: { id: shop.id }, data: { installedAt: later(-60_000) } });
}
function order(suffix: string, amount = "20.00", quantity = 2) {
  const stamp = later(-1000).toISOString();
  return {
    id: `gid://shopify/Order/${suffix}`, legacyResourceId: suffix,
    createdAt: stamp, updatedAt: stamp,
    cancelledAt: { available: true, value: null },
    total: { available: true, value: { amount, currencyCode: "USD" } },
    lines: { available: true, value: [{ id: `gid://shopify/LineItem/${suffix}`, currentQuantity: quantity }] },
  };
}
function page(orders: ReturnType<typeof order>[], next: string | null = null): SyncPage {
  return { orders: orders.map(({ id, createdAt, updatedAt }) => ({ id, createdAt, updatedAt })), hasNextPage: next !== null, endCursor: next };
}
async function snapshots(shopId: string) {
  const rows = await prisma.orderSnapshot.findMany({ where: { shopId }, orderBy: { orderId: "asc" } });
  return rows.map(row => JSON.parse(openOrder(row.encryptedSnapshot, `${row.shopId}:${row.generation}:${row.orderId}`)));
}
async function runOrder(orders: ReturnType<typeof order>[], at = later(1000)) {
  return processOneOrderJob(async job => {
    const value = orders.find(item => item.id === job.orderId);
    assert.ok(value, "Worker requested an unexpected order ID");
    return value;
  }, { now: at });
}

test("bounded sync recovers an omitted event and compares identities and exact relevant fields", async () => {
  const shop = await fixture();
  const first = order("101", "1234567890123456789.0100", 4), missed = order("102", "20.00", 2);
  await acceptOrderJob(shop.domain, randomUUID(), first.id);
  assert.equal((await runOrder([first])).status, "completed");
  assert.deepEqual(await snapshots(shop.id), [first]);
  let fetches = 0;
  const fetch = async (input: { windowStart: Date; windowEnd: Date; cursor: string | null }) => {
    fetches++;
    assert.equal(input.windowStart.toISOString(), shop.installedAt.toISOString());
    assert.equal(input.windowEnd.toISOString(), now.toISOString());
    assert.equal(input.cursor, null);
    return page([first, missed]);
  };
  await advanceOrderSync(shop.id, fetch, now);
  assert.equal((await prisma.orderJob.findFirstOrThrow({ where: { shopId: shop.id, deliveryId: { startsWith: "sync:" } } })).minimumUpdatedAt?.toISOString(), first.updatedAt);
  await advanceOrderSync(shop.id, fetch, later(10));
  assert.equal(fetches, 1, "Waiting checkpoint must not refetch");
  assert.equal((await getOrderSyncStatus(shop.id)).lastSuccessAt, null);
  await runOrder([first, missed]); await runOrder([first, missed]);
  await advanceOrderSync(shop.id, fetch, later(2000));
  assert.deepEqual(await snapshots(shop.id), [first, missed]);
  assert.equal((await getOrderSyncStatus(shop.id)).lastSuccessAt?.toISOString(), later(2000).toISOString());
  await advanceOrderSync(shop.id, fetch, later(2001));
  assert.equal(fetches, 1, "Successful pass waits for next periodic deadline");
});

test("interrupted page retains cursor and durable page replay creates no duplicate effects", async () => {
  const shop = await fixture();
  const first = order("201"), second = order("202", "99.990", 9);
  await advanceOrderSync(shop.id, async () => page([first], "cursor-one"), now);
  const initial = await prisma.orderSyncState.findUniqueOrThrow({ where: { shopId: shop.id } });
  await runOrder([first]);
  await advanceOrderSync(shop.id, async input => {
    assert.equal(input.cursor, "cursor-one");
    throw new Error("Synthetic interrupted page");
  }, later(2000));
  const failedPage = await prisma.orderSyncState.findUniqueOrThrow({ where: { shopId: shop.id } });
  assert.equal(failedPage.phase, "retry");
  assert.equal(failedPage.cursor, "cursor-one");
  assert.equal(failedPage.lastSuccessAt, null);
  assert.deepEqual(await snapshots(shop.id), [first]);
  // Simulate restoring the same already-committed first-page checkpoint after
  // a crash. The delivery key is stable for run/page/order, so upsert reuses it.
  await prisma.orderSyncState.update({ where: { shopId: shop.id }, data: { phase: "scanning", cursor: null, pageNo: 0, nextRunAt: later(3000), attempts: 0, pendingJobIds: [] } });
  await advanceOrderSync(shop.id, async () => page([first], "cursor-one"), later(3000));
  assert.equal(await prisma.orderJob.count({ where: { shopId: shop.id } }), 1);
  assert.equal((await prisma.orderSyncState.findUniqueOrThrow({ where: { shopId: shop.id } })).runId, initial.runId);
  await advanceOrderSync(shop.id, async input => { assert.equal(input.cursor, "cursor-one"); return page([second]); }, later(4000));
  await runOrder([second], later(5000));
  await advanceOrderSync(shop.id, async () => { throw new Error("No page expected"); }, later(6000));
  assert.deepEqual(await snapshots(shop.id), [first, second]);
  assert.equal((await getOrderSyncStatus(shop.id)).phase, "idle");
});

test("partial protected fields preserve a coverage gap; explicit retry recovers it", async () => {
  const shop = await fixture();
  const value = order("301");
  await advanceOrderSync(shop.id, async () => page([value]), now);
  await processOneOrderJob(async () => ({ ...value, total: { available: false, reason: "TOTAL_UNAVAILABLE" } }), { now: later(1000) });
  await advanceOrderSync(shop.id, async () => { throw new Error("No refetch"); }, later(2000));
  const status = await getOrderSyncStatus(shop.id);
  assert.equal(status.phase, "failed");
  assert.equal(status.lastError, "SYNC_FIELDS_UNAVAILABLE");
  assert.equal(status.lastSuccessAt, null);
  await resetOrderSync(shop.id, later(3000));
  await advanceOrderSync(shop.id, async () => page([value]), later(3000));
  await runOrder([value], later(4000));
  await advanceOrderSync(shop.id, async () => { throw new Error("No refetch"); }, later(5000));
  assert.deepEqual(await snapshots(shop.id), [value]);
  assert.equal((await getOrderSyncStatus(shop.id)).phase, "idle");
});

test("bounded page failures never report success or acknowledge an advanced checkpoint", async () => {
  const shop = await fixture();
  const reject = async () => { throw new Error("Synthetic access failure with private details"); };
  await advanceOrderSync(shop.id, reject, now);
  await advanceOrderSync(shop.id, reject, later(120_000));
  await advanceOrderSync(shop.id, reject, later(360_000));
  const state = await prisma.orderSyncState.findUniqueOrThrow({ where: { shopId: shop.id } });
  assert.equal(state.phase, "failed");
  assert.equal(state.attempts, 3);
  assert.equal(state.cursor, null);
  assert.equal(state.lastSuccessAt, null);
  const status = await getOrderSyncStatus(shop.id);
  assert.equal(status.lastError, "SYNC_PAGE_UNAVAILABLE");
  assert.equal(JSON.stringify(status).includes("private details"), false);
  assert.equal(await prisma.orderJob.count({ where: { shopId: shop.id } }), 0);
});

test("same order identifier in separate synthetic shops remains tenant-bound; concurrent sync claims once", async () => {
  const a = await fixture(), b = await fixture();
  const left = order("401", "12.3400", 3), right = order("401", "987.00", 8);
  let calls = 0;
  const fetch = async () => { calls++; return page([left]); };
  await Promise.all([advanceOrderSync(a.id, fetch, now), advanceOrderSync(a.id, fetch, now)]);
  assert.equal(calls, 1);
  await advanceOrderSync(b.id, async () => page([right]), now);
  for (let index = 0; index < 2; index++) await processOneOrderJob(async job => job.shopId === a.id ? left : right, { now: later(1000) });
  for (const shop of [a, b]) await advanceOrderSync(shop.id, async () => { throw new Error("No page expected"); }, later(2000));
  assert.deepEqual(await snapshots(a.id), [left]);
  assert.deepEqual(await snapshots(b.id), [right]);
  const row = await prisma.orderSnapshot.findFirstOrThrow({ where: { shopId: a.id } });
  assert.throws(() => openOrder(row.encryptedSnapshot, `${b.id}:${b.generation}:${left.id}`), /ORDER_DECRYPTION_FAILED/);
  assert.equal((await getOrderSyncStatus(a.id)).backlog, 0);
  assert.equal((await getOrderSyncStatus(b.id)).backlog, 0);
});

test("throttled discovery preserves checkpoint and respects a bounded Retry-After deadline", async () => {
  const shop = await fixture();
  await advanceOrderSync(shop.id, async () => { throw new OrderApiError("API_THROTTLED", 180_000); }, now);
  const state = await prisma.orderSyncState.findUniqueOrThrow({ where: { shopId: shop.id } });
  assert.equal(state.phase, "retry");
  assert.equal(state.lastError, "API_THROTTLED");
  assert.ok(state.nextRunAt >= later(180_000));
  assert.equal(state.cursor, null);
  let calls = 0;
  await advanceOrderSync(shop.id, async () => { calls++; return page([]); }, later(60_000));
  assert.equal(calls, 0);
  await advanceOrderSync(shop.id, async () => { calls++; return page([]); }, later(181_000));
  await advanceOrderSync(shop.id, async () => { throw new Error("Unexpected fetch"); }, later(182_000));
  assert.equal(calls, 1);
  assert.equal((await getOrderSyncStatus(shop.id)).phase, "idle");
});
