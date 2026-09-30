import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Session } from "@shopify/shopify-api";
import { setAbstractFetchFunc } from "@shopify/shopify-api/runtime";
import prisma, { authLockDb } from "../app/db.server";
import { activateShop } from "../app/storage.server";
import { sessionStorage } from "../app/shopify.server";
import { acceptOrderJob, processOneOrderJob } from "../app/order-jobs.server";
import { loader as exceptions } from "../app/routes/api.exceptions";
import { loader as evaluations } from "../app/routes/api.evaluations";
import { loader as detail, action as decision } from "../app/routes/api.exceptions.$id";
import { loader as settings, action as saveSettings } from "../app/routes/api.rule-settings";

const domains = [0, 1].map(() => `exceptions-http-${randomUUID()}.myshopify.com`);
const originalFetch = globalThis.fetch;
const key = process.env.SHOPIFY_API_KEY!;
const secret = process.env.SHOPIFY_API_SECRET!;
let aId: string;
let bId: string;

function token(domain: string, overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iss: `https://${domain}/admin`, dest: `https://${domain}`,
    aud: key, sub: "123", iat: now, nbf: now - 1, exp: now + 60, sid: randomUUID(), jti: randomUUID(), ...overrides })).toString("base64url");
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}
function request(index = 0, method = "GET", body?: unknown, jwt: string | null = token(domains[index])) {
  return new Request(`https://app.example.test/api/resource?shop=${domains[1]}&id_token=${token(domains[1])}`, {
    method, headers: { ...(jwt === null ? {} : { authorization: `Bearer ${jwt}` }), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function args(request: Request, id = "") {
  return { request, params: { id }, context: {}, url: new URL(request.url), pattern: "/api/resource/:id" };
}
const validSettings = (threshold = "100.00") => ({ ruleKey: "high_order_value", settings: { enabled: true, threshold, currencyCode: "CAD" }, expectedRevision: 0 });
const validAction = (expectedRevision: number) => ({ action: "acknowledge", reason: "REVIEW_STARTED", expectedRevision });

before(async () => {
  assert.equal(process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB, "1");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1");
  globalThis.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    const index = domains.findIndex((domain) => url.startsWith(`https://${domain}/`));
    if (index < 0) throw Error("UNEXPECTED_NETWORK_BLOCKED");
    if (url.endsWith("/graphql.json")) return Response.json({ data: { shop: { id: `gid://shopify/Shop/${3001 + index}`, myshopifyDomain: domains[index] } } });
    if (url.endsWith("/admin/oauth/access_token")) return Response.json({ access_token: "synthetic-access", scope: "read_orders", expires_in: 3600,
      refresh_token: "synthetic-refresh", refresh_token_expires_in: 86400 });
    throw Error("UNEXPECTED_NETWORK_BLOCKED");
  };
  setAbstractFetchFunc(globalThis.fetch);
  for (const [index, domain] of domains.entries()) {
    const shop = await activateShop(domain, `gid://shopify/Shop/${3001 + index}`);
    await prisma.shop.update({ where: { id: shop.id }, data: { installedAt: new Date(Date.now() - 60_000) } });
    await sessionStorage.storeSession(new Session({ id: `offline_${domain}`, shop: domain, state: "", isOnline: false, scope: "read_orders",
      accessToken: "synthetic-access", expires: new Date(Date.now() + 3600000), refreshToken: "synthetic-refresh", refreshTokenExpires: new Date(Date.now() + 86400000) }));
    assert.equal((await saveSettings(args(request(index, "PUT", validSettings())))).status, 200);
    const stamp = new Date(Date.now() - 1000).toISOString();
    const orderId = `gid://shopify/Order/${5001 + index}`;
    await acceptOrderJob(domain, randomUUID(), orderId);
    const processed = await processOneOrderJob(async () => ({ id: orderId, createdAt: stamp, updatedAt: stamp,
      cancelledAt: { available: true, value: null }, total: { available: true, value: { amount: "100.01", currencyCode: "CAD" } },
      lines: { available: false, reason: "LINES_UNAVAILABLE" } }));
    assert.equal(processed.status, "completed");
  }
});
after(async () => {
  globalThis.fetch = originalFetch;
  setAbstractFetchFunc(originalFetch);
  await prisma.shop.deleteMany({ where: { domain: { in: domains } } });
  await prisma.session.deleteMany({ where: { shop: { in: domains } } });
  await Promise.all([prisma.$disconnect(), authLockDb.$disconnect()]);
});

test("every lifecycle read independently rejects absent/invalid/expired bearer tokens without caching", async () => {
  for (const read of [exceptions, evaluations, detail, settings]) {
    for (const jwt of [null, "invalid", token(domains[0], { exp: 1 }), token(domains[0], { aud: "wrong-audience" })]) {
      const response = await read(args(request(0, "GET", undefined, jwt)));
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(await response.text(), "");
    }
  }
});

test("authenticated endpoints expose only own persisted settings/evaluations/exceptions", async () => {
  for (const index of [0, 1]) {
    const listed = await exceptions(args(request(index)));
    assert.equal(listed.status, 200);
    const page = await listed.json();
    const records = page.items;
    assert.equal(page.nextCursor, null);
    assert.equal(records.length, 1);
    if (index === 0) aId = records[0].id; else bId = records[0].id;
    assert.equal(records[0].state, "open");
    const own = await detail(args(request(index), records[0].id));
    assert.equal(own.status, 200);
    const text = await own.text();
    assert.equal(text.includes("synthetic-access"), false);
    assert.equal(text.includes("synthetic-refresh"), false);
    assert.equal((await settings(args(request(index)))).status, 200);
    assert.equal((await evaluations(args(request(index)))).status, 200);
  }
  assert.notEqual(aId, bId);
});

test("foreign direct-ID read/action is bodyless404 and cannot modify the other shop", async () => {
  const before = await (await detail(args(request(1), bId))).json();
  for (const response of [await detail(args(request(0), bId)), await decision(args(request(0, "POST", validAction(before.revision)), bId))]) {
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.deepEqual(await (await detail(args(request(1), bId))).json(), before);
});

test("verified token actor is required; caller actor and tenant cannot be supplied", async () => {
  const own = await (await detail(args(request(), aId))).json();
  for (const extra of [{ actor: "999" }, { shopId: "foreign-shop" }, { generation: 99 }]) {
    assert.equal((await decision(args(request(0, "POST", { ...validAction(own.revision), ...extra }), aId))).status, 400);
  }
  for (const sub of ["", "0", "123\n", "actor-name"])
    assert.equal((await decision(args(request(0, "POST", validAction(own.revision), token(domains[0], { sub })), aId))).status, 401);
  assert.equal((await decision(args(request(0, "POST", validAction(own.revision), null), aId))).status, 401);
  assert.equal((await decision(args(request(0, "POST", validAction(own.revision), token(domains[0], { exp: 1 })), aId))).status, 401);
  const action = await decision(args(request(0, "POST", validAction(own.revision)), aId));
  assert.equal(action.status, 200);
  const changed = await action.json();
  assert.equal(changed.state, "acknowledged");
  const audit = changed.history.find((entry: { kind: string }) => entry.kind === "decision");
  assert.equal(audit.actor, "123");
  assert.equal(audit.reason, "REVIEW_STARTED");
  assert.equal(audit.result.ruleVersion, "1.0.0");
  assert.equal(audit.result.settingsVersion, own.currentEvaluation.settingsVersion);
  assert.equal((await decision(args(request(0, "POST", validAction(own.revision)), aId))).status, 409);
});

test("settings boundary rejects missing/default thresholds, spoofed identity and outdated revision", async () => {
  assert.equal((await saveSettings(args(request(0, "PUT", { ...validSettings("-1"), expectedRevision: 1 })))).status, 400);
  assert.equal((await saveSettings(args(request(0, "PUT", { ...validSettings(), expectedRevision: 1, settings: { enabled: true, currencyCode: "CAD" } })))).status, 400);
  assert.equal((await saveSettings(args(request(0, "PUT", { ...validSettings(), settings: { ...validSettings().settings, shopId: "foreign" } })))).status, 400);
  assert.equal((await saveSettings(args(request(0, "PUT", validSettings())))).status, 409);
  assert.equal((await saveSettings(args(request(0, "PUT", validSettings(), null)))).status, 401);
});

test("mutation request bodies are JSON-only, bounded and schema-restricted", async () => {
  const own = await (await detail(args(request(), aId))).json();
  const oversize = request(0, "POST", { ...validAction(own.revision), reason: "x".repeat(9000) });
  assert.equal((await decision(args(oversize, aId))).status, 413);
  const malformed = new Request("https://app.example.test/api/resource", { method: "POST", headers: { authorization: `Bearer ${token(domains[0])}`, "content-type": "application/json" }, body: "{" });
  assert.equal((await decision(args(malformed, aId))).status, 400);
  const wrongType = new Request("https://app.example.test/api/resource", { method: "POST", headers: { authorization: `Bearer ${token(domains[0])}`, "content-type": "text/plain" }, body: "{}" });
  assert.equal((await decision(args(wrongType, aId))).status, 415);
  assert.equal((await decision(args(request(0, "PATCH", validAction(own.revision)), aId))).status, 405);
});
