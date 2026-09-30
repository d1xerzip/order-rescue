import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// This process never loads .env.local and cannot contact Shopify.
assert.equal(process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB, "1");
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "55435");
assert.match(url.pathname, /^\/rescue_restore_(source|target)_\d+$/);
globalThis.fetch = async () => { throw new Error("RESTORE_NETWORK_FORBIDDEN"); };
const source = resolve(process.env.RELIABILITY_SOURCE_ROOT || ".");
const load = (name: string) => import(pathToFileURL(resolve(source, "app", name)).href);
const { default: db, authLockDb } = await load("db.server.ts") as typeof import("../app/db.server");
const { activateShop } = await load("storage.server.ts") as typeof import("../app/storage.server");
const { acceptOrderJob, processOneOrderJob } = await load("order-jobs.server.ts") as typeof import("../app/order-jobs.server");
const { saveRuleSettings, listRuleSettings, listExceptions, getException, actOnException } = await load("exceptions.server.ts") as typeof import("../app/exceptions.server");
const { processOnePrivacyJob, applyPrivacyJournal } = await load("privacy.server.ts") as typeof import("../app/privacy.server");
const { receivePrivacyWebhook } = await load("privacy-webhook.server.ts") as typeof import("../app/privacy-webhook.server");
const { privacyBlocked, readDeletionJournal } = await load("privacy-guard.server.ts") as typeof import("../app/privacy-guard.server");
const { openOrder } = await load("order-crypto.server.ts") as typeof import("../app/order-crypto.server");
const domainA = "restore-a.myshopify.com", domainB = "restore-b.myshopify.com";
const erasedId = "gid://shopify/Order/99001", retainedId = "gid://shopify/Order/99002";
const tables = ["Shop", "OrderSnapshot", "RuleSetting", "RuleEvaluation", "ExceptionRecord", "ExceptionHistory", "OrderJob", "OrderSyncState", "PrivacyDeletion"];
const file = process.env.RELIABILITY_EXPECTED_PATH!;
const serialize = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v);
async function records() {
  const result: Record<string, string[]> = {};
  for (const table of tables) result[table] = (await db.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${table}"`)).map(serialize).sort();
  return result;
}
async function fixtureShop(domain: string, id: string) {
  const initial = await activateShop(domain, `gid://shopify/Shop/${id}`);
  const shop = await db.shop.update({ where: { id: initial.id }, data: { installedAt: new Date(Date.now() - 60_000) } });
  const principal = { shopId: shop.id, generation: shop.generation, actor: "synthetic-restore-staff" };
  await saveRuleSettings(principal, "high_order_value", { enabled: true, threshold: "100.00", currencyCode: "CAD" }, 0);
  await saveRuleSettings(principal, "high_line_quantity", { enabled: true, threshold: 5 }, 0);
  return { shop, principal };
}
async function ingest(domain: string, id: string) {
  const stamp = new Date(Date.now() - 1000).toISOString();
  const snapshot = { id, legacyResourceId: id.split("/").at(-1)!, createdAt: stamp, updatedAt: stamp,
    cancelledAt: { available: true as const, value: null }, total: { available: true as const, value: { amount: "100.01", currencyCode: "CAD" } },
    lines: { available: true as const, value: [{ id: "gid://shopify/LineItem/99101", currentQuantity: 6 }] } };
  assert.equal((await acceptOrderJob(domain, randomUUID(), id)).accepted, true);
  assert.equal((await processOneOrderJob(async () => snapshot)).status, "completed");
  const shop = await db.shop.findUniqueOrThrow({ where: { domain } });
  const stored = await db.orderSnapshot.findUniqueOrThrow({ where: { shopId_generation_orderId: { shopId: shop.id, generation: shop.generation, orderId: id } } });
  assert.deepEqual(JSON.parse(openOrder(stored.encryptedSnapshot, `${shop.id}:${shop.generation}:${id}`)), snapshot);
}
const mode = process.argv[2];
try {
  if (mode === "seed") {
    const a = await fixtureShop(domainA, "99901"), b = await fixtureShop(domainB, "99902");
    await ingest(a.shop.domain, erasedId); await ingest(a.shop.domain, retainedId); await ingest(b.shop.domain, erasedId);
    const exception = (await listExceptions(a.principal)).find(row => row.orderId === retainedId && row.ruleKey === "high_order_value")!;
    await actOnException(a.principal, exception.id, { action: "ignore", reason: "NOT_RELEVANT", expectedRevision: exception.revision });
    // A queued pre-deletion event must not resurrect data after restoring the old DB.
    assert.equal((await acceptOrderJob(domainA, "restore-queued", erasedId)).accepted, true);
    const expected = await records();
    assert.equal(expected.OrderSnapshot.length, 3); assert.equal(expected.RuleEvaluation.length, 6);
    assert.equal(expected.RuleSetting.length, 4); assert.equal(expected.ExceptionRecord.length, 6);
    assert.equal(expected.ExceptionHistory.length, 7);
    writeFileSync(file, serialize(expected), { mode: 0o600, flag: "wx" });
  } else if (mode === "delete") {
    const raw = JSON.stringify({ shop_domain: domainA, shop_id: 99901, customer: { id: 99301 }, orders_to_redact: [99001] });
    const request = new Request("https://app.example.test/webhooks/privacy", { method: "POST", body: raw, headers: {
      "x-shopify-shop-domain": domainA, "x-shopify-topic": "customers/redact", "x-shopify-webhook-id": "restore-redaction",
      "x-shopify-hmac-sha256": createHmac("sha256", process.env.SHOPIFY_API_SECRET!).update(raw).digest("base64") } });
    assert.equal((await receivePrivacyWebhook(request, "customers/redact")).status, 200);
    assert.equal((await processOnePrivacyJob()).status, "completed");
    assert.equal(await db.orderSnapshot.count(), 2); assert.equal(readDeletionJournal().length, 1);
  } else if (mode === "compare") {
    assert.deepEqual(await records(), JSON.parse(readFileSync(file, "utf8")));
    assert.equal(await db.privacyDeletion.count(), 0);
  } else if (mode === "rollback") {
    assert.equal(JSON.parse(readFileSync(resolve(source, "package.json"), "utf8")).version, "0.8.1");
    const a = await db.shop.findUniqueOrThrow({ where: { domain: domainA } });
    const principal = { shopId: a.id, generation: a.generation, actor: "synthetic-rollback-staff" };
    const rawErased = await db.exceptionRecord.findFirstOrThrow({ where: { shopId: a.id, orderId: erasedId } });
    assert.equal(await db.$transaction(tx => privacyBlocked(tx, domainA, erasedId, a.installedAt)), true);
    await assert.rejects(getException(principal, rawErased.id), { code: "NOT_FOUND" });
    assert.equal((await acceptOrderJob(domainA, "restore-replay", erasedId)).accepted, false);
    let fetched = false;
    await processOneOrderJob(async () => { fetched = true; throw new Error("MUST_NOT_FETCH"); });
    assert.equal(fetched, false);
    await applyPrivacyJournal();
    assert.equal(await db.orderSnapshot.count({ where: { shopId: a.id, orderId: erasedId } }), 0);
    assert.equal(await db.orderJob.count({ where: { shopId: a.id, orderId: erasedId } }), 0);
    assert.equal(await db.ruleEvaluation.count(), 4); assert.equal(await db.exceptionRecord.count(), 4);
    assert.equal(await db.exceptionHistory.count(), 5); assert.equal(await db.privacyDeletion.count(), 1);
    const b = await db.shop.findUniqueOrThrow({ where: { domain: domainB } });
    assert.equal(await db.orderSnapshot.count({ where: { shopId: b.id, orderId: erasedId } }), 1);
    assert.equal((await listRuleSettings(principal)).length, 2);
    const retained = (await listExceptions(principal)).find(row => row.ruleKey === "high_order_value")!;
    const detail = await getException(principal, retained.id);
    assert.equal(detail.state, "ignored"); assert.equal(detail.history.length, 2);
    // Baseline server functions can still write current-schema state after restore.
    const settings = (await listRuleSettings(principal)).find(row => row.settings.ruleKey === "high_line_quantity")!;
    await saveRuleSettings(principal, "high_line_quantity", { enabled: true, threshold: 7 }, settings.revision);
    assert.equal((await listRuleSettings(principal)).find(row => row.settings.ruleKey === "high_line_quantity")!.revision, settings.revision + 1);
    await ingest(domainA, "gid://shopify/Order/99003");
    const newRows = (await listExceptions(principal)).filter(row => row.orderId.endsWith("/99003"));
    assert.equal(newRows.length, 1); assert.equal(newRows[0].ruleKey, "high_order_value");
    await actOnException(principal, newRows[0].id, { action: "resolve", reason: "REVIEW_COMPLETED", expectedRevision: newRows[0].revision });
    assert.equal((await getException(principal, newRows[0].id)).state, "resolved");
    await assert.rejects(getException({ shopId: b.id, generation: b.generation, actor: "synthetic-foreign" }, newRows[0].id), { code: "NOT_FOUND" });
    assert.equal(readDeletionJournal().length, 1);
  } else throw new Error("UNKNOWN_RESTORE_MODE");
  console.log(JSON.stringify({ mode, status: "PASS" }));
} finally { await Promise.all([db.$disconnect(), authLockDb.$disconnect()]); }
