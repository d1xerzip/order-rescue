import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { Session } from "@shopify/shopify-api";
import { setAbstractFetchFunc } from "@shopify/shopify-api/runtime";
import prisma, { authLockDb } from "../app/db.server";
import {
  activateShop,
  getOwnWorkspaceRecord,
  requireActiveShop,
  canRunOrdinaryJob,
} from "../app/storage.server";
import { sessionStorage } from "../app/shopify.server";
import {
  authenticatedBackground,
  authenticateShopRequest,
} from "../app/auth.server";
import { lifecycleWebhook } from "../app/webhooks.server";
import { loader, action } from "../app/routes/api.workspace.$id";

const key = process.env.SHOPIFY_API_KEY!;
const secret = process.env.SHOPIFY_API_SECRET!;
const a = `http-${randomUUID()}.myshopify.com`,
  b = `http-${randomUUID()}.myshopify.com`;
const fetchOriginal = globalThis.fetch;
let exchanges = 0;
let rejectExchange = false;
let rejectIdentity = false;
let exchangeFailureStatus = 400;
let identityQueries = 0;
const grants: string[] = [];
before(async () => {
  assert.equal(process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB, "1");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1");
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (![a, b].some((domain) => url.startsWith(`https://${domain}/`)))
      throw new Error("UNEXPECTED_NETWORK_BLOCKED");
    if (url.endsWith("/graphql.json")) {
      identityQueries++;
      if (rejectIdentity)
        return Response.json({
          errors: [{ message: "Synthetic temporary failure" }],
        });
      const domain = new URL(url).hostname;
      return Response.json({
        data: {
          shop: {
            id: `gid://shopify/Shop/${domain === a ? 1001 : 1002}`,
            myshopifyDomain: domain,
          },
        },
      });
    }
    if (!url.endsWith("/admin/oauth/access_token"))
      throw new Error("UNEXPECTED_NETWORK_BLOCKED");
    exchanges++;
    const data = JSON.parse(String(init?.body || "{}"));
    grants.push(data.grant_type);
    if (rejectExchange)
      return Response.json(
        { error: "invalid_subject_token" },
        { status: exchangeFailureStatus },
      );
    return Response.json({
      access_token: `synthetic-rotated-${exchanges}`,
      scope: "read_orders",
      expires_in: 3600,
      refresh_token: `synthetic-refresh-${exchanges}`,
      refresh_token_expires_in: 86400,
      grant_type: data.grant_type,
    });
  };
  setAbstractFetchFunc(globalThis.fetch);
  await activateShop(a, "gid://shopify/Shop/1001");
  await activateShop(b, "gid://shopify/Shop/1002");
  for (const shop of [a, b])
    await sessionStorage.storeSession(
      new Session({
        id: `offline_${shop}`,
        shop,
        state: "",
        isOnline: false,
        scope: "read_orders",
        accessToken: "synthetic-access",
        expires: new Date(Date.now() + 3600000),
        refreshToken: "synthetic-refresh",
        refreshTokenExpires: new Date(Date.now() + 86400000),
      }),
    );
});
after(async () => {
  globalThis.fetch = fetchOriginal;
  setAbstractFetchFunc(fetchOriginal);
  await prisma.$disconnect();
  await authLockDb.$disconnect();
});
function jwt(shop: string, overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  );
  const p = Buffer.from(
    JSON.stringify({
      iss: `https://${shop}/admin`,
      dest: `https://${shop}`,
      aud: key,
      sub: "123",
      exp: now + 60,
      nbf: now - 1,
      iat: now,
      sid: randomUUID(),
      jti: randomUUID(),
      ...overrides,
    }),
  ).toString("base64url");
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
}
function req(
  shop: string,
  id: string,
  method = "GET",
  body?: unknown,
  token = jwt(shop),
) {
  return new Request(`https://app.example.test/api/workspace/${id}?shop=${b}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function args(request: Request, id: string) {
  return {
    request,
    params: { id },
    context: {},
    url: new URL(request.url),
    pattern: "/api/workspace/:id",
  };
}
function webhook(
  topic: string,
  shop: string,
  body: unknown,
  valid = true,
  id = randomUUID(),
) {
  const text = JSON.stringify(body);
  return new Request("https://app.example.test/webhooks/test", {
    method: "POST",
    headers: {
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": shop,
      "x-shopify-api-version": "2026-07",
      "x-shopify-webhook-id": id,
      "x-shopify-hmac-sha256": valid
        ? createHmac("sha256", secret).update(text).digest("base64")
        : "invalid",
      "content-type": "application/json",
    },
    body: text,
  });
}
async function statusOf(operation: Promise<unknown>) {
  try {
    const r = await operation;
    return r instanceof Response ? r.status : 200;
  } catch (e) {
    if (e instanceof Response) return e.status;
    throw e;
  }
}

test("official signed-token auth derives shop from token, ignoring query tenant", async () => {
  const shop = await requireActiveShop(a);
  assert.ok(shop);
  const own = await getOwnWorkspaceRecord(shop.id);
  assert.ok(own);
  const result = await loader(args(req(a, own.id), own.id));
  assert.equal(result.status, 200);
  const text = await result.text();
  assert.equal(text.includes("synthetic-access"), false);
  assert.equal(text.includes("refreshToken"), false);
  assert.equal(exchanges, 0);
});
test("direct foreign-ID route reads and writes are denied without changing B", async () => {
  const shop = await requireActiveShop(b);
  assert.ok(shop);
  const record = await getOwnWorkspaceRecord(shop.id);
  assert.ok(record);
  assert.equal((await loader(args(req(a, record.id), record.id))).status, 404);
  assert.equal(
    (
      await action(
        args(req(a, record.id, "PATCH", { displayName: "Foreign" }), record.id),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await prisma.workspaceRecord.findUniqueOrThrow({
        where: { id: record.id },
      })
    ).displayName,
    "Order Rescue",
  );
  assert.equal(
    (
      await action(
        args(
          req(b, record.id, "PATCH", { displayName: "My workspace" }),
          record.id,
        ),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await action(
        args(
          req(b, record.id, "PATCH", {
            displayName: "Override",
            shopId: "forged",
          }),
          record.id,
        ),
      )
    ).status,
    400,
  );
});
test("expired, wrong audience and tampered tokens are rejected by official auth", async () => {
  for (const token of [
    jwt(a, { exp: Math.floor(Date.now() / 1000) - 120 }),
    jwt(a, { aud: "wrong-app" }),
    jwt(a) + "x",
  ]) {
    const status = await statusOf(
      loader(args(req(a, "foreign", "GET", undefined, token), "foreign")),
    );
    assert.ok([401, 403].includes(status));
  }
  assert.equal(
    exchanges,
    0,
    "Invalid ID tokens must not reach Shopify token exchange",
  );
});
test("invalid webhook HMAC is rejected before any lifecycle write", async () => {
  const response = await lifecycleWebhook(
    webhook("app/uninstalled", a, { myshopify_domain: a }, false),
    "app/uninstalled",
  );
  assert.equal(response.status, 401);
  assert.ok(await requireActiveShop(a));
});
test("background expired offline token rotates using SDK; rotation persists encrypted", async () => {
  const s = await sessionStorage.loadSession(`offline_${a}`);
  assert.ok(s);
  s.expires = new Date(Date.now() - 60000);
  await sessionStorage.storeSession(s);
  const shop = await requireActiveShop(a);
  assert.ok(shop);
  await authenticatedBackground(a, shop.generation);
  assert.equal(exchanges, 1);
  const rotated = await sessionStorage.loadSession(s.id);
  assert.equal(rotated?.accessToken, "synthetic-rotated-1");
  const stored = await prisma.session.findUniqueOrThrow({
    where: { id: s.id },
  });
  assert.notEqual(stored.accessToken, rotated?.accessToken);
});
test("uninstall with expired offline token never refreshes, disables jobs; privacy remains available", async () => {
  const s = await sessionStorage.loadSession(`offline_${a}`);
  assert.ok(s);
  s.expires = new Date(Date.now() - 60000);
  await sessionStorage.storeSession(s);
  const shop = await requireActiveShop(a);
  assert.ok(shop);
  rejectExchange = true;
  const before = exchanges;
  assert.equal(
    (
      await lifecycleWebhook(
        webhook("app/uninstalled", a, { myshopify_domain: a }),
        "app/uninstalled",
      )
    ).status,
    200,
  );
  assert.equal(exchanges, before);
  assert.equal(await canRunOrdinaryJob(a, shop.generation), false);
  assert.equal(await sessionStorage.loadSession(s.id), undefined);
  assert.equal(
    (
      await lifecycleWebhook(
        webhook("customers/data_request", a, {
          shop_domain: a,
          orders_requested: [123],
          customer: { email: "synthetic@example.invalid" },
          data_request: { id: 456 },
        }),
        "customers/data_request",
      )
    ).status,
    200,
  );
  const privacy = await prisma.privacyReceipt.findFirstOrThrow({
    where: { shopDomain: a },
  });
  assert.equal(privacy.status, "pending");
  assert.deepEqual(privacy.payload, {
    orders_requested: ["123"],
    requestId: "456",
  });
  assert.equal(exchanges, before);
  await assert.rejects(
    authenticatedBackground(a, shop.generation),
    /INACTIVE_INSTALLATION/,
  );
  const status = await statusOf(authenticateShopRequest(req(a, "any")));
  assert.ok([401, 403].includes(status));
  assert.equal(await requireActiveShop(a), null);
});
test("reinstall requires successful fresh token exchange; old job generation stays disabled", async () => {
  const old = await prisma.shop.findUniqueOrThrow({ where: { domain: a } });
  rejectExchange = false;
  const result = await authenticateShopRequest(req(a, "any"));
  assert.equal(result.shop.generation, old.generation + 1);
  assert.equal(await canRunOrdinaryJob(a, old.generation), false);
  const generation = result.shop.generation;
  await authenticateShopRequest(req(a, "any"));
  assert.equal((await requireActiveShop(a))?.generation, generation);
});

test("signed webhook body for A cannot deactivate B through a forged shop header", async () => {
  await activateShop(a);
  await activateShop(b);
  const response = await lifecycleWebhook(
    webhook("app/uninstalled", b, { myshopify_domain: a }),
    "app/uninstalled",
  );
  assert.equal(response.status, 400);
  assert.ok(await requireActiveShop(b));
  const privacy = await lifecycleWebhook(
    webhook("shop/redact", b, { shop_domain: a }),
    "shop/redact",
  );
  assert.equal(privacy.status, 400);
  const status = await statusOf(
    lifecycleWebhook(
      webhook("app/scopes_update", b, { shop_id: 1001, current: [] }),
      "app/scopes_update",
    ),
  );
  assert.equal(status, 400);
  const shop = await requireActiveShop(b);
  assert.ok(shop?.jobsEnabled);
});
test("scope removal disables ordinary jobs without revoking the privacy path", async () => {
  const response = await lifecycleWebhook(
    webhook("app/scopes_update", b, {
      shop_id: "gid://shopify/Shop/1002",
      current: [],
    }),
    "app/scopes_update",
  );
  assert.equal(response.status, 200);
  const shop = await requireActiveShop(b);
  assert.ok(shop);
  assert.equal(await canRunOrdinaryJob(b, shop.generation), false);
});

test("nullable uninstall domain binds the signed Shop ID and rejects foreign ID", async () => {
  assert.equal(
    await statusOf(
      lifecycleWebhook(
        webhook("app/uninstalled", b, { id: 1001, myshopify_domain: null }),
        "app/uninstalled",
      ),
    ),
    400,
  );
  assert.ok(await requireActiveShop(b));
  assert.equal(
    await statusOf(
      lifecycleWebhook(
        webhook("app/uninstalled", b, { id: 1002, myshopify_domain: null }),
        "app/uninstalled",
      ),
    ),
    200,
  );
  assert.equal(await requireActiveShop(b), null);
});
test("failed identity lookup clears cached credentials and recovers on fresh reopen", async () => {
  rejectIdentity = true;
  await assert.rejects(authenticateShopRequest(req(b, "any")));
  assert.equal(await sessionStorage.loadSession(`offline_${b}`), undefined);
  assert.equal(await requireActiveShop(b), null);
  rejectIdentity = false;
  const result = await authenticateShopRequest(req(b, "any"));
  assert.equal(result.shop.domain, b);
  assert.ok(result.shop.active);
});
test("parallel authenticated requests complete with one application DB connection", async () => {
  const result = await Promise.all(
    Array.from({ length: 4 }, () => authenticateShopRequest(req(a, "any"))),
  );
  assert.ok(result.every((x) => x.shop.domain === a));
});

test("rejected or unavailable refresh fails closed; fresh browser auth recovers the same installation", async () => {
  const shop = await requireActiveShop(a);
  assert.ok(shop);
  for (const status of [400, 500]) {
    const session = await sessionStorage.loadSession(`offline_${a}`);
    assert.ok(session);
    session.expires = new Date(Date.now() - 60000);
    await sessionStorage.storeSession(session);
    const before = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    const queriesBefore = identityQueries;
    const grantsBefore = grants.length;
    exchangeFailureStatus = status;
    rejectExchange = true;
    try {
      await assert.rejects(authenticatedBackground(a, shop.generation));
      assert.equal(identityQueries, queriesBefore);
      assert.ok(grants.length > grantsBefore);
      assert.ok(
        grants.slice(grantsBefore).every((grant) => grant === "refresh_token"),
      );
      const after = await prisma.session.findUniqueOrThrow({
        where: { id: session.id },
      });
      assert.equal(after.accessToken, before.accessToken);
      assert.equal(after.refreshToken, before.refreshToken);
      assert.equal(after.expires?.getTime(), before.expires?.getTime());
      assert.equal((await requireActiveShop(a))?.generation, shop.generation);
    } finally {
      rejectExchange = false;
      exchangeFailureStatus = 400;
    }
    const recoveryStart = grants.length;
    const recovered = await authenticateShopRequest(req(a, "any"));
    assert.equal(recovered.shop.generation, shop.generation);
    assert.ok(
      grants
        .slice(recoveryStart)
        .includes("urn:ietf:params:oauth:grant-type:token-exchange"),
    );
    const restored = await sessionStorage.loadSession(session.id);
    assert.ok(restored?.expires && restored.expires > new Date());
    await authenticatedBackground(a, shop.generation);
  }
});
