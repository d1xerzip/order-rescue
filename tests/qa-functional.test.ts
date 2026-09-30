import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { Session } from "@shopify/shopify-api";
import { setAbstractFetchFunc } from "@shopify/shopify-api/runtime";
import prisma, { authLockDb } from "../app/db.server";
import { activateShop } from "../app/storage.server";
import { sessionStorage } from "../app/shopify.server";
import { acceptOrderJob, processOneOrderJob } from "../app/order-jobs.server";
import { openOrder } from "../app/order-crypto.server";
import { loader as evaluationPage } from "../app/routes/api.evaluations";
import { loader as detail, action as decision } from "../app/routes/api.exceptions.$id";
import { loader as settingsPage, action as saveSettings } from "../app/routes/api.rule-settings";
import { loader as sync } from "../app/routes/api.sync";
import type { RuleKey, RuleResult } from "../app/rules/contracts";

type Case = {
  name: string; shop: "A" | "B"; order: string; revision: number;
  amount: string | null; currency: string; quantities: number[] | null; cancelled?: boolean;
  expected: { value: string; quantity: string; valueReason: string; quantityReason: string; exceptions: RuleKey[];
    matchingLines?: { id: string; currentQuantity: number }[] };
};
// Expectations are read before any app setup/evaluation, never derived from evaluator output.
const specification = JSON.parse(readFileSync(new URL("../docs/fixtures/p10a-release.json", import.meta.url), "utf8")) as {
  format: number; synthetic: boolean;
  settings: Record<"A" | "B", { value: { enabled: boolean; threshold: string; currencyCode: string }; quantity: { enabled: boolean; threshold: number } }>;
  cases: Case[];
};
const domains = [0, 1].map(() => `qa-functional-${randomUUID()}.myshopify.com`);
const originalFetch = globalThis.fetch;
const base = Date.now() - 20_000;
const createdAt = new Date(base).toISOString();
const shops: Array<{ id: string; generation: number; domain: string }> = [];
const versions: Array<Record<RuleKey, string>> = [];
let identityReads = 0;

function token(index: number, overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iss: `https://${domains[index]}/admin`, dest: `https://${domains[index]}`,
    aud: process.env.SHOPIFY_API_KEY, sub: "123", iat: now, nbf: now - 1, exp: now + 60,
    sid: randomUUID(), jti: randomUUID(), ...overrides })).toString("base64url");
  return `${head}.${body}.${createHmac("sha256", process.env.SHOPIFY_API_SECRET!).update(`${head}.${body}`).digest("base64url")}`;
}
function request(index: number, method = "GET", body?: unknown, jwt = token(index)) {
  return new Request(`https://app.example.test/api/resource?shop=${domains[1 - index]}&limit=50`, {
    method, headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function args(request: Request, id = "") {
  return { request, params: { id }, context: {}, url: new URL(request.url), pattern: "/api/resource/:id" };
}
function input(item: Case) {
  const updatedAt = new Date(base + item.revision * 1000).toISOString();
  return { id: `gid://shopify/Order/${item.order}`, legacyResourceId: item.order, createdAt, updatedAt,
    cancelledAt: { available: true, value: item.cancelled ? updatedAt : null },
    total: item.amount === null ? { available: false, reason: "TOTAL_UNAVAILABLE" } : { available: true, value: { amount: item.amount, currencyCode: item.currency } },
    lines: item.quantities === null ? { available: false, reason: "LINES_UNAVAILABLE" } : { available: true, value: item.quantities.map((currentQuantity, index) => ({ id: `gid://shopify/LineItem/${501 + index}`, currentQuantity })) },
  };
}

before(async () => {
  assert.equal(specification.format, 1); assert.equal(specification.synthetic, true);
  assert.equal(process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB, "1");
  const dbUrl = new URL(process.env.DATABASE_URL!);
  assert.equal(dbUrl.hostname, "127.0.0.1"); assert.equal(dbUrl.port, "55433");
  assert.match(dbUrl.pathname, /^\/rescue_test_\d+$/);
  globalThis.fetch = async incoming => {
    const url = new URL(incoming instanceof Request ? incoming.url : String(incoming));
    const index = domains.indexOf(url.hostname);
    if (url.protocol !== "https:" || index < 0) throw Error("QA_UNEXPECTED_NETWORK_BLOCKED");
    if (url.pathname.endsWith("/graphql.json")) {
      identityReads++;
      return Response.json({ data: { shop: { id: `gid://shopify/Shop/${76001 + index}`, myshopifyDomain: domains[index] } } });
    }
    if (url.pathname === "/admin/oauth/access_token") return Response.json({ access_token: "synthetic-qa-access", scope: "read_orders", expires_in: 3600,
      refresh_token: "synthetic-qa-refresh", refresh_token_expires_in: 86400 });
    throw Error("QA_UNEXPECTED_NETWORK_BLOCKED");
  };
  setAbstractFetchFunc(globalThis.fetch);
  for (const [index, domain] of domains.entries()) {
    const shop = await activateShop(domain, `gid://shopify/Shop/${76001 + index}`);
    await prisma.shop.update({ where: { id: shop.id }, data: { installedAt: new Date(base - 1000) } });
    shops.push(shop);
    await sessionStorage.storeSession(new Session({ id: `offline_${domain}`, shop: domain, state: "", isOnline: false, scope: "read_orders",
      accessToken: "synthetic-qa-access", expires: new Date(Date.now() + 3600000), refreshToken: "synthetic-qa-refresh", refreshTokenExpires: new Date(Date.now() + 86400000) }));
    const absent = await settingsPage(args(request(index)));
    assert.equal(absent.status, 200); assert.deepEqual(await absent.json(), []);
    const settings = specification.settings[index === 0 ? "A" : "B"];
    const savedVersions = {} as Record<RuleKey, string>;
    for (const [ruleKey, value] of [["high_order_value", settings.value], ["high_line_quantity", settings.quantity]] as const) {
      const saved = await saveSettings(args(request(index, "PUT", { ruleKey, settings: value, expectedRevision: 0 })));
      assert.equal(saved.status, 200);
      const row = await saved.json(); assert.equal(row.revision, 1);
      savedVersions[ruleKey] = row.settings.settingsVersion;
      assert.equal(row.settings.shopId, shop.id);
      assert.deepEqual(Object.fromEntries(Object.keys(value).map(key => [key, row.settings[key]])), value);
    }
    versions.push(savedVersions);
    const reopened = await settingsPage(args(request(index)));
    assert.equal(reopened.status, 200);
    const rows = await reopened.json();
    assert.deepEqual(rows.map((row: { settings: { ruleKey: RuleKey; settingsVersion: string } }) => row.settings.settingsVersion).sort(), Object.values(savedVersions).sort());
  }
});
after(async () => {
  globalThis.fetch = originalFetch; setAbstractFetchFunc(originalFetch);
  await prisma.shop.deleteMany({ where: { domain: { in: domains } } });
  await prisma.session.deleteMany({ where: { shop: { in: domains } } });
  await Promise.all([prisma.$disconnect(), authLockDb.$disconnect()]);
});

test("P10A literal release dataset: persisted settings, normal worker, exact snapshots and HTTP evidence", async t => {
  for (const item of specification.cases) await t.test(item.name, async () => {
    const index = item.shop === "A" ? 0 : 1;
    const shop = shops[index]; const snapshot = input(item);
    const accepted = await acceptOrderJob(shop.domain, randomUUID(), snapshot.id);
    assert.equal(accepted.accepted, true);
    const processed = await processOneOrderJob(async (job, tenant) => {
      assert.equal(job.orderId, snapshot.id); assert.equal(job.shopId, shop.id);
      assert.equal(tenant.id, shop.id); assert.equal(tenant.domain, shop.domain);
      return structuredClone(snapshot);
    });
    assert.equal(processed.status, "completed"); assert.equal(processed.jobId, accepted.jobId);
    const stored = await prisma.orderSnapshot.findUniqueOrThrow({ where: { shopId_generation_orderId: { shopId: shop.id, generation: shop.generation, orderId: snapshot.id } } });
    assert.deepEqual(JSON.parse(openOrder(stored.encryptedSnapshot, `${shop.id}:${shop.generation}:${snapshot.id}`)), snapshot);
    assert.equal(stored.orderCreatedAt.toISOString(), createdAt); assert.equal(stored.orderUpdatedAt.toISOString(), snapshot.updatedAt);
    assert.equal(stored.expiresAt.getTime(), base + 30 * 86400000);
    const response = await evaluationPage(args(request(index))); assert.equal(response.status, 200);
    const page = await response.json(); assert.equal(page.nextCursor, null);
    const results: RuleResult[] = page.items.filter((row: { orderId: string }) => row.orderId === snapshot.id).map((row: { result: RuleResult }) => row.result);
    assert.equal(results.length, 2);
    for (const [ruleKey, expectedOutcome, expectedReason] of [
      ["high_order_value", item.expected.value, item.expected.valueReason],
      ["high_line_quantity", item.expected.quantity, item.expected.quantityReason],
    ] as const) {
      const result = results.find(row => row.ruleKey === ruleKey)!;
      assert.equal(result.outcome, expectedOutcome); assert.equal(result.reasonCode, expectedReason);
      assert.equal(result.ruleVersion, "1.0.0"); assert.equal(result.settingsVersion, versions[index][ruleKey]);
      assert.equal(result.sourceUpdatedAt, snapshot.updatedAt); assert.match(result.sourceSnapshotVersion, /^sha256:[0-9a-f]{64}$/);
      assert.deepEqual(result, processed.evaluations![ruleKey]);
      if (ruleKey === "high_order_value" && (expectedOutcome === "matched" || expectedOutcome === "not_matched")) {
        assert.deepEqual(result.evidence, { kind: "value", field: "Order.currentTotalPriceSet.shopMoney", amount: item.amount,
          threshold: specification.settings[item.shop].value.threshold, currencyCode: item.currency });
      }
      if (ruleKey === "high_line_quantity" && item.expected.matchingLines) {
        assert.deepEqual(result.evidence, { kind: "lines", threshold: specification.settings[item.shop].quantity.threshold, matchingLines: item.expected.matchingLines });
      }
    }
    assert.equal(results[0].sourceSnapshotVersion, results[1].sourceSnapshotVersion);
    assert.equal(results[0].evaluatedAt, results[1].evaluatedAt);
    const records = await prisma.exceptionRecord.findMany({ where: { shopId: shop.id, generation: shop.generation, orderId: snapshot.id }, orderBy: { ruleKey: "asc" } });
    assert.deepEqual(records.map(row => row.ruleKey), item.expected.exceptions);
    for (const record of records) {
      assert.equal(record.state, "open");
      const shown = await detail(args(request(index), record.id)); assert.equal(shown.status, 200);
      const view = await shown.json(); assert.equal(view.orderId, snapshot.id); assert.equal(view.ruleKey, record.ruleKey);
      assert.equal(view.orderUrl, `https://${shop.domain}/admin/orders/${item.order}`);
      assert.equal(view.currentEvaluation.settingsVersion, versions[index][record.ruleKey as RuleKey]);
    }
  });
});

test("P10A unchanged replay keeps persisted exception identities, revisions and history", async () => {
  const item = specification.cases.find(row => row.order === "98010" && row.revision === 2)!;
  const shop = shops[0]; const snapshot = input(item);
  const before = await prisma.exceptionRecord.findMany({ where: { shopId: shop.id, orderId: snapshot.id }, include: { history: true }, orderBy: { ruleKey: "asc" } });
  await acceptOrderJob(shop.domain, randomUUID(), snapshot.id);
  assert.equal((await processOneOrderJob(async () => snapshot)).status, "completed");
  const afterReplay = await prisma.exceptionRecord.findMany({ where: { shopId: shop.id, orderId: snapshot.id }, include: { history: true }, orderBy: { ruleKey: "asc" } });
  assert.deepEqual(afterReplay, before);
});

test("P10A signed foreign-ID HTTP read/action deny access and preserve the target", async () => {
  const foreign = await prisma.exceptionRecord.findFirstOrThrow({ where: { shopId: shops[0].id } });
  const before = await detail(args(request(0), foreign.id)); assert.equal(before.status, 200);
  const beforeRecord = await before.json();
  for (const response of [await detail(args(request(1), foreign.id)), await decision(args(request(1, "POST", { action: "resolve", reason: "REVIEW_COMPLETED", expectedRevision: foreign.revision }), foreign.id))]) {
    assert.equal(response.status, 404); assert.equal(await response.text(), "");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const afterRequest = await detail(args(request(0), foreign.id)); assert.deepEqual(await afterRequest.json(), beforeRecord);
});

test("P10A sync status derives the shop from verified token and rejects invalid/expired access", async () => {
  for (const [index, shop] of shops.entries()) {
    await prisma.orderSyncState.create({ data: { shopId: shop.id, generation: shop.generation, phase: "idle",
      lastSuccessAt: new Date(base + 3000 + index * 1000), nextRunAt: new Date(Date.now() + 3600000) } });
    const response = await sync(args(request(index))); assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json(); assert.equal(result.lastSuccessAt, new Date(base + 3000 + index * 1000).toISOString());
  }
  const readsBefore = identityReads;
  for (const jwt of ["invalid", token(0, { exp: 1 }), token(0, { aud: "foreign-app" })]) {
    await assert.rejects(sync(args(request(0, "GET", undefined, jwt))), error => {
      assert.ok(error instanceof Response); assert.equal(error.status, 401); return true;
    });
  }
  assert.equal(identityReads, readsBefore, "Invalid tokens cannot perform the Shopify identity lookup");
});
