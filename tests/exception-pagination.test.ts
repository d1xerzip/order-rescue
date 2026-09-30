import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import prisma, { authLockDb } from "../app/db.server";
import { activateShop, receivePrivacy } from "../app/storage.server";
import { acceptOrderJob, processOneOrderJob } from "../app/order-jobs.server";
import { actOnException, getException, listEvaluationsPage, listExceptionsPage, pageOptions, saveRuleSettings, type Principal } from "../app/exceptions.server";

const domains = [0, 1].map(() => `pagination-${randomUUID()}.myshopify.com`);
const principals: Principal[] = [];
const createdAt = new Date(Date.now() - 10_000).toISOString();
async function ingest(index: number, orderNumber: number, amount = "101.00") {
  const orderId = `gid://shopify/Order/${orderNumber}`;
  await acceptOrderJob(domains[index], randomUUID(), orderId);
  const result = await processOneOrderJob(async () => ({ id: orderId, createdAt, updatedAt: createdAt,
    cancelledAt: { available: true, value: null }, total: { available: true, value: { amount, currencyCode: "CAD" } },
    lines: { available: false, reason: "LINES_UNAVAILABLE" } }));
  assert.equal(result.status, "completed");
}
const errorStatus = (status: number) => (error: unknown) => { assert.equal((error as { status: number }).status, status); return true; };
before(async () => {
  assert.equal(process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB, "1");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1");
  for (const domain of domains) {
    const activated = await activateShop(domain);
    const shop = await prisma.shop.update({ where: { id: activated.id }, data: { installedAt: new Date(Date.now() - 60_000) } });
    const principal = { shopId: shop.id, generation: shop.generation, actor: "synthetic-merchant-9001" };
    principals.push(principal);
    await saveRuleSettings(principal, "high_order_value", { enabled: true, threshold: "100.00", currencyCode: "CAD" }, 0);
  }
  for (let i = 0; i < 26; i++) await ingest(0, 88000 + i);
  await ingest(1, 99000);
  await ingest(1, 99001);
});
after(async () => {
  await prisma.privacyReceipt.deleteMany({ where: { shopDomain: { in: domains } } });
  await prisma.shop.deleteMany({ where: { domain: { in: domains } } });
  await Promise.all([prisma.$disconnect(), authLockDb.$disconnect()]);
});

test("exception pages are bounded summaries and traverse every ID once with trusted order links", async () => {
  const first = await listExceptionsPage(principals[0]);
  assert.equal(first.items.length, 20); assert.ok(first.nextCursor);
  assert.ok(first.items.every(item => !("history" in item) && item.currentEvaluation && Array.isArray(item.freshness)));
  const second = await listExceptionsPage(principals[0], { cursor: first.nextCursor });
  assert.equal(second.items.length, 6); assert.equal(second.nextCursor, null);
  const all = [...first.items, ...second.items];
  assert.equal(new Set(all.map(item => item.id)).size, 26);
  assert.deepEqual(all.map(item => item.id), all.map(item => item.id).sort());
  for (const item of all) assert.equal(item.orderUrl, `https://${domains[0]}/admin/orders/${item.orderId.split("/").at(-1)}`);
  const other = await listExceptionsPage(principals[1]);
  assert.ok(other.items.every(item => item.orderUrl?.startsWith(`https://${domains[1]}/admin/orders/`)));
  const detail = await getException(principals[0], first.items[0].id);
  assert.equal(detail.orderUrl, first.items[0].orderUrl);
  await assert.rejects(getException(principals[1], detail.id), errorStatus(404));
});

test("evaluation pages support max50 and resume by stable ID without omissions or duplicates", async () => {
  const first = await listEvaluationsPage(principals[0], { limit: 50 });
  assert.equal(first.items.length, 50); assert.ok(first.nextCursor);
  const second = await listEvaluationsPage(principals[0], { limit: 50, cursor: first.nextCursor });
  assert.equal(second.items.length, 2); assert.equal(second.nextCursor, null);
  const all = [...first.items, ...second.items];
  assert.equal(new Set(all.map(item => item.id)).size, 52);
  assert.equal(all.filter(item => item.result.reasonCode === "NOT_CONFIGURED").length, 26);
  const again = await listEvaluationsPage(principals[0], { limit: 50, cursor: first.nextCursor });
  assert.deepEqual(again, second);
});

test("page cursors reject invalid shape, other shop, other generation and other endpoint", async () => {
  const exceptions = await listExceptionsPage(principals[0], { limit: 1 });
  const evaluations = await listEvaluationsPage(principals[0], { limit: 1 });
  for (const cursor of ["", "%%%", Buffer.from("{}").toString("base64url"), evaluations.nextCursor!])
    await assert.rejects(listExceptionsPage(principals[0], { cursor }), errorStatus(400));
  await assert.rejects(listExceptionsPage(principals[1], { cursor: exceptions.nextCursor }), errorStatus(400));
  const decoded = JSON.parse(Buffer.from(exceptions.nextCursor!, "base64url").toString());
  decoded.generation++;
  await assert.rejects(listExceptionsPage(principals[0], { cursor: Buffer.from(JSON.stringify(decoded)).toString("base64url") }), errorStatus(400));
  for (const limit of [0, -1, 51, 1.5, NaN, Infinity]) await assert.rejects(listExceptionsPage(principals[0], { limit }), errorStatus(400));
});

test("history remains bounded and latest decision stays available independently of its page", async () => {
  for (let i = 0; i < 23; i++) await ingest(1, 99000, `${102 + i}.00`);
  const rows = await listExceptionsPage(principals[1]);
  const row = rows.items.find(item => item.orderId === "gid://shopify/Order/99000")!;
  const result = await actOnException(principals[1], row.id, { action: "ignore", reason: "NOT_RELEVANT", expectedRevision: row.revision });
  assert.equal(result.history.length, 20); assert.ok(result.historyNextCursor);
  assert.equal(result.latestDecision?.action, "ignore"); assert.equal(result.latestDecision?.revision, 25);
  assert.ok(result.history.every(item => item.kind === "observation"));
  const second = await getException(principals[1], row.id, { cursor: result.historyNextCursor });
  assert.equal(second.history.length, 5); assert.equal(second.historyNextCursor, null);
  assert.deepEqual([...result.history, ...second.history].map(item => item.revision), Array.from({ length: 25 }, (_, i) => i + 1));
  assert.deepEqual(second.latestDecision, result.latestDecision);
  const other = rows.items.find(item => item.id !== row.id)!;
  await assert.rejects(getException(principals[1], other.id, { cursor: result.historyNextCursor }), errorStatus(400));
  await assert.rejects(listExceptionsPage(principals[1], { cursor: result.historyNextCursor }), errorStatus(400));
});

test("pending privacy entries consume scan positions but never erase the continuation", async () => {
  const before = await listExceptionsPage(principals[0], { limit: 2 });
  await receivePrivacy(domains[0], "customers/redact", randomUUID(), { orders_to_redact: before.items.map(item => item.orderId.split("/").at(-1)) });
  const hidden = await listExceptionsPage(principals[0], { limit: 2 });
  assert.deepEqual(hidden.items, []); assert.equal(hidden.nextCursor, before.nextCursor);
  const found: string[] = [];
  let cursor = hidden.nextCursor;
  do {
    const page = await listExceptionsPage(principals[0], { limit: 2, cursor });
    found.push(...page.items.map(item => item.id)); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(found.length, 24); assert.equal(new Set(found).size, 24);
  const firstEvaluation = await listEvaluationsPage(principals[0], { limit: 1 });
  if (firstEvaluation.items.length) await receivePrivacy(domains[0], "customers/redact", randomUUID(), { orders_to_redact: [firstEvaluation.items[0].orderId.split("/").at(-1)] });
  const hiddenEvaluation = await listEvaluationsPage(principals[0], { limit: 1 });
  assert.deepEqual(hiddenEvaluation.items, []); assert.ok(hiddenEvaluation.nextCursor);
});

test("HTTP query boundary rejects ambiguous limits and uses the detail historyCursor", () => {
  const request = (query: string) => new Request(`https://app.example.test/api/exceptions?${query}`);
  for (const query of ["limit=", "limit=-1", "limit=1.5", "limit=2&limit=3", "cursor=a&cursor=b"])
    assert.throws(() => pageOptions(request(query)), errorStatus(400));
  assert.deepEqual(pageOptions(request("limit=7&historyCursor=abc"), "historyCursor"), { limit: 7, cursor: "abc" });
  assert.deepEqual(pageOptions(request("")), { limit: undefined, cursor: null });
});
