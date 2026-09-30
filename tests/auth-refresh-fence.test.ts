import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ServerResponse } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { Session } from "@shopify/shopify-api";
import { setAbstractFetchFunc } from "@shopify/shopify-api/runtime";
import prisma, { authLockDb } from "../app/db.server";
import { authOperation, withAuthLock } from "../app/auth-lock.server";
import { authenticatedBackground } from "../app/auth.server";
import { sessionStorage } from "../app/shopify.server";
import { activateShop, deactivateShop, requireActiveShop } from "../app/storage.server";
import { lifecycleWebhook } from "../app/webhooks.server";
import { oauthFetch, OAUTH_TIMEOUT_MS } from "../app/oauth-fetch.server";

type Plan = { mode: "success" | "headers" | "body" | "hold"; calls: number; closed: number; response?: ServerResponse; arrived?: () => void };
const plans = new Map<string, Plan>();
const shops: string[] = [];
const nativeFetch = globalThis.fetch;
let origin = "";
const server = createServer((request, response) => {
  const domain = request.headers["x-synthetic-shop"];
  const plan = typeof domain === "string" && plans.get(domain);
  if (!plan || request.url !== "/admin/oauth/access_token") { response.writeHead(404).end(); return; }
  plan.calls++;
  plan.response = response;
  response.on("close", () => { plan.closed++; });
  request.resume();
  if (plan.mode === "body") {
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"access_token":"synthetic-incomplete');
  } else if (plan.mode === "success") reply(response);
  plan.arrived?.();
});
function reply(response: ServerResponse) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ access_token: "synthetic-rotated", refresh_token: "synthetic-rotated-refresh", scope: "read_orders", expires_in: 3600, refresh_token_expires_in: 86400 }));
}
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
async function until(check: () => boolean, duration = 1500) {
  const start = Date.now();
  while (!check() && Date.now() - start < duration) await new Promise(r => setTimeout(r, 10));
  assert.ok(check(), "Expected native HTTP socket to close after cancellation");
}
function session(domain: string, token = "synthetic-original", expired = true) {
  return new Session({ id: `offline_${domain}`, shop: domain, state: "", isOnline: false, scope: "read_orders", accessToken: token, refreshToken: "synthetic-refresh", expires: new Date(Date.now() + (expired ? -60000 : 3600000)), refreshTokenExpires: new Date(Date.now() + 86400000) });
}
async function seed(mode: Plan["mode"] = "success") {
  const domain = `fence-${randomUUID()}.myshopify.com`;
  shops.push(domain);
  const plan: Plan = { mode, calls: 0, closed: 0 };
  plans.set(domain, plan);
  const shop = await activateShop(domain);
  await sessionStorage.storeSession(session(domain));
  return { domain, shop, plan };
}
async function uninstall(domain: string) {
  const body = JSON.stringify({ myshopify_domain: domain });
  const response = await lifecycleWebhook(new Request("https://app.example.test/webhooks/app/uninstalled", { method: "POST", headers: {
    "content-type": "application/json", "x-shopify-topic": "app/uninstalled", "x-shopify-shop-domain": domain, "x-shopify-api-version": "2026-07",
    "x-shopify-webhook-id": randomUUID(), "x-shopify-hmac-sha256": createHmac("sha256", process.env.SHOPIFY_API_SECRET!).update(body).digest("base64"),
  }, body }), "app/uninstalled");
  assert.equal(response.status, 200);
}
before(async () => {
  const database = new URL(process.env.DATABASE_URL!);
  assert.equal(process.env.RUN_MODE, "test");
  assert.equal(process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB, "1");
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.port, "55433");
  assert.match(database.pathname, /^\/rescue_test_\d+$/);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== "https:" || !plans.has(url.hostname) || url.pathname !== "/admin/oauth/access_token") throw new Error("UNEXPECTED_NETWORK_BLOCKED");
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("x-synthetic-shop", url.hostname);
    return nativeFetch(origin + url.pathname, { ...(input instanceof Request ? { method: input.method, signal: input.signal } : {}), ...init, headers });
  };
  setAbstractFetchFunc(oauthFetch);
});
after(async () => {
  globalThis.fetch = nativeFetch;
  setAbstractFetchFunc(nativeFetch);
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await prisma.lifecycleDelivery.deleteMany({ where: { shopDomain: { in: shops } } });
  await prisma.session.deleteMany({ where: { shop: { in: shops } } });
  await prisma.shop.deleteMany({ where: { domain: { in: shops } } });
  await prisma.$disconnect();
  await authLockDb.$disconnect();
});

for (const mode of ["headers", "body"] as const) test(`OAuth ${mode} stall cancels native HTTP and preserves stored credentials`, async () => {
  const { domain, shop, plan } = await seed(mode);
  const before = await prisma.session.findUniqueOrThrow({ where: { id: `offline_${domain}` } });
  const start = Date.now();
  await assert.rejects(authenticatedBackground(domain, shop.generation));
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= OAUTH_TIMEOUT_MS - 500 && elapsed < OAUTH_TIMEOUT_MS + 5000, `Deadline elapsed ${elapsed} ms`);
  assert.equal(plan.calls, 1);
  await until(() => plan.closed === 1);
  const after = await prisma.session.findUniqueOrThrow({ where: { id: before.id } });
  assert.deepEqual(after, before);
  assert.equal((await requireActiveShop(domain))?.generation, shop.generation);
  plan.mode = "success";
  const recovered = await authenticatedBackground(domain, shop.generation);
  assert.equal(recovered.session.accessToken, "synthetic-rotated");
  assert.equal(recovered.session.refreshToken, "synthetic-rotated-refresh");
  assert.equal(plan.calls, 2);
  const saved = await prisma.session.findUniqueOrThrow({ where: { id: before.id } });
  assert.match(saved.accessToken!, /^v1:/);
  assert.match(saved.refreshToken!, /^v1:/);
  assert.notEqual(saved.accessToken, before.accessToken);
  assert.notEqual(saved.refreshToken, before.refreshToken);
  assert.equal((await sessionStorage.loadSession(saved.id))?.accessToken, "synthetic-rotated");
});

test("OAuth preserves cancellation from Request and RequestInit signals", async () => {
  for (const placement of ["request", "init"] as const) {
    const { domain, plan } = await seed("headers");
    const arrived = deferred();
    plan.arrived = () => arrived.resolve();
    const controller = new AbortController();
    const url = `https://${domain}/admin/oauth/access_token`;
    const pending = placement === "request"
      ? oauthFetch(new Request(url, { signal: controller.signal }))
      : oauthFetch(url, { signal: controller.signal });
    const rejected = assert.rejects(pending);
    await arrived.promise;
    const start = Date.now();
    controller.abort();
    await rejected;
    await until(() => plan.closed === 1);
    assert.ok(Date.now() - start < 1500);
  }
});

test("concurrent refreshes of one shop perform one exchange and preserve another shop", async () => {
  const { domain, shop, plan } = await seed("hold");
  const other = await seed();
  const originalOther = await prisma.session.findUniqueOrThrow({ where: { id: `offline_${other.domain}` } });
  const arrived = deferred();
  plan.arrived = () => arrived.resolve();
  const requests = Promise.all(Array.from({ length: 4 }, () => authenticatedBackground(domain, shop.generation)));
  await arrived.promise;
  reply(plan.response!);
  const results = await requests;
  assert.equal(plan.calls, 1);
  assert.ok(results.every(result => result.session.accessToken === "synthetic-rotated"));
  assert.deepEqual(await prisma.session.findUniqueOrThrow({ where: { id: originalOther.id } }), originalOther);
});

test("parallel refresh and signed uninstall serialize; fresh reinstall rejects old generation and callback", async () => {
  const { domain, shop, plan } = await seed("hold");
  const arrived = deferred();
  plan.arrived = () => arrived.resolve();
  const refreshing = authenticatedBackground(domain, shop.generation);
  await arrived.promise;
  const both = Promise.all([refreshing, uninstall(domain)]);
  reply(plan.response!);
  await both;
  assert.equal(await requireActiveShop(domain), null);
  assert.equal(await prisma.session.count({ where: { shop: domain } }), 0);
  const late = deferred();
  let oldCallback!: Promise<void>;
  await withAuthLock(domain, async () => {
    oldCallback = late.promise.then(async () => { await sessionStorage.storeSession(session(domain, "synthetic-stale")); });
  });
  const lateRejected = assert.rejects(oldCallback, /STALE_AUTH_OPERATION/);
  const reinstalled = await withAuthLock(domain, async () => {
    const active = await activateShop(domain);
    await sessionStorage.storeSession(session(domain, "synthetic-new-install", false));
    return active;
  });
  assert.equal(reinstalled.generation, shop.generation + 1);
  late.resolve();
  await lateRejected;
  await assert.rejects(authenticatedBackground(domain, shop.generation), /INACTIVE_INSTALLATION/);
  assert.equal((await authenticatedBackground(domain, reinstalled.generation)).session.accessToken, "synthetic-new-install");
  assert.equal(plan.calls, 1);
});

test("terminated auth transaction cannot overwrite a reinstalled session even while callback remains active", async () => {
  const { domain, shop } = await seed();
  const backend = deferred<number>();
  const continueOld = deferred();
  let staleActivationRejected = false;
  const old = withAuthLock(domain, async () => {
    const context = authOperation(domain)!;
    const [row] = await context.tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    backend.resolve(row.pid);
    await continueOld.promise;
    assert.equal(context.active, true);
    staleActivationRejected = await activateShop(domain).then(() => false, () => true);
    await sessionStorage.storeSession(session(domain, "synthetic-stale-after-termination"));
  });
  const rejected = assert.rejects(old);
  const pid = await backend.promise;
  // Only this test's positively identified transaction backend in fresh test DB.
  const [terminated] = await prisma.$queryRaw<Array<{ stopped: boolean }>>`SELECT pg_terminate_backend(pid) AS stopped FROM pg_stat_activity WHERE pid = ${pid} AND datname = current_database() AND pid <> pg_backend_pid()`;
  assert.equal(terminated?.stopped, true);
  // Synthetic setup uses the other pool while the old callback is deliberately paused.
  await deactivateShop(domain, randomUUID());
  const fresh = await activateShop(domain);
  assert.equal(fresh.generation, shop.generation + 1);
  await sessionStorage.storeSession(session(domain, "synthetic-fresh-after-termination", false));
  const before = await prisma.session.findUniqueOrThrow({ where: { id: `offline_${domain}` } });
  const shopBefore = await prisma.shop.findUniqueOrThrow({ where: { domain } });
  continueOld.resolve();
  await rejected;
  assert.equal(staleActivationRejected, true);
  assert.deepEqual(await prisma.shop.findUniqueOrThrow({ where: { domain } }), shopBefore);
  assert.deepEqual(await prisma.session.findUniqueOrThrow({ where: { id: before.id } }), before);
  assert.equal((await sessionStorage.loadSession(before.id))?.accessToken, "synthetic-fresh-after-termination");
});

test("cross-domain auth context and non-test writes without context reject", async () => {
  const a = await seed(), b = await seed();
  const before = await prisma.session.findUniqueOrThrow({ where: { id: `offline_${b.domain}` } });
  await assert.rejects(withAuthLock(a.domain, () => sessionStorage.storeSession(session(b.domain, "synthetic-foreign"))), /STALE_AUTH_OPERATION/);
  const previous = process.env.RUN_MODE;
  try {
    process.env.RUN_MODE = "worker";
    await assert.rejects(sessionStorage.storeSession(session(b.domain, "synthetic-no-context")), /AUTH_OPERATION_REQUIRED/);
  } finally { process.env.RUN_MODE = previous; }
  assert.deepEqual(await prisma.session.findUniqueOrThrow({ where: { id: before.id } }), before);
});
