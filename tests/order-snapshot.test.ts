import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchOrderSnapshot,
  type OrderGraphql,
} from "../app/order-snapshot.server";

const shop = {
  shopifyId: "gid://shopify/Shop/1",
  domain: "synthetic.myshopify.com",
};
const legacy = "90071992547409931234";
const id = `gid://shopify/Order/${legacy}`;
const revision = "2026-09-29T12:00:00.000Z";
const authority = {
  shop: { id: shop.shopifyId, myshopifyDomain: shop.domain },
  currentAppInstallation: { accessScopes: [{ handle: "read_orders" }] },
};
function order(overrides: Record<string, unknown> = {}) {
  return {
    id,
    legacyResourceId: legacy,
    createdAt: revision,
    updatedAt: revision,
    cancelledAt: null,
    currentTotalPriceSet: {
      shopMoney: { amount: "9007199254740993.0100", currencyCode: "CAD" },
    },
    lineItems: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    ...overrides,
  };
}
function response(data: unknown, status = 200, version = "2026-07") {
  return Response.json(data, {
    status,
    headers: { "X-Shopify-API-Version": version },
  });
}
function scripted(responses: Response[]) {
  const calls: Array<{ query: string; variables?: Record<string, unknown> }> =
    [];
  const graphql: OrderGraphql = async (query, options) => {
    calls.push({ query, variables: options?.variables });
    const next = responses.shift();
    assert.ok(next, "Unexpected extra API request");
    return next;
  };
  return { graphql, calls };
}
const authResponse = () => response({ data: authority });
const revisionResponse = () =>
  response({ data: { order: { id, updatedAt: revision } } });

test("snapshot preserves exact IDs, money and complete multi-page line quantities", async () => {
  const { graphql, calls } = scripted([
    authResponse(),
    response({
      data: {
        order: order({
          lineItems: {
            nodes: [{ id: "gid://shopify/LineItem/1", currentQuantity: 0 }],
            pageInfo: { hasNextPage: true, endCursor: "a" },
          },
        }),
      },
    }),
    response({
      data: {
        order: order({
          lineItems: {
            nodes: [{ id: "gid://shopify/LineItem/2", currentQuantity: 12 }],
            pageInfo: { hasNextPage: false, endCursor: "b" },
          },
        }),
      },
    }),
    revisionResponse(),
  ]);
  const result = await fetchOrderSnapshot(graphql, id, shop);
  assert.equal(result.legacyResourceId, legacy);
  assert.deepEqual(result.total, {
    available: true,
    value: { amount: "9007199254740993.0100", currencyCode: "CAD" },
  });
  assert.deepEqual(result.cancelledAt, { available: true, value: null });
  assert.equal(result.lines.available && result.lines.value.length, 2);
  assert.equal(calls[2].variables?.after, "a");
});

test("missing fields stay unavailable while empty lines and null cancellation are known", async () => {
  const complete = scripted([
    authResponse(),
    response({ data: { order: order() } }),
    revisionResponse(),
  ]);
  assert.deepEqual(
    (await fetchOrderSnapshot(complete.graphql, id, shop)).lines,
    { available: true, value: [] },
  );
  const missing = scripted([
    authResponse(),
    response({
      data: {
        order: order({
          cancelledAt: undefined,
          currentTotalPriceSet: null,
          lineItems: null,
        }),
      },
    }),
    revisionResponse(),
  ]);
  const result = await fetchOrderSnapshot(missing.graphql, id, shop);
  assert.equal(result.cancelledAt.available, false);
  assert.equal(result.total.available, false);
  assert.equal(result.lines.available, false);
});

test("authority, scope, API version, HTTP and GraphQL failures never fetch an order", async () => {
  const failures: Array<[Response, string]> = [
    [
      response({
        data: {
          ...authority,
          shop: { id: "gid://shopify/Shop/2", myshopifyDomain: shop.domain },
        },
      }),
      "SHOP_IDENTITY_MISMATCH",
    ],
    [
      response({
        data: { ...authority, currentAppInstallation: { accessScopes: [] } },
      }),
      "ORDER_SCOPE_MISSING",
    ],
    [response({ data: authority }, 200, "2026-10"), "API_VERSION_UNVERIFIED"],
    [response({}, 503), "API_UNAVAILABLE"],
    [
      response({ data: authority, errors: [{ message: "synthetic denied" }] }),
      "GRAPHQL_UNAVAILABLE",
    ],
  ];
  for (const [failure, code] of failures) {
    const mock = scripted([failure]);
    await assert.rejects(fetchOrderSnapshot(mock.graphql, id, shop), {
      message: code,
    });
    assert.equal(mock.calls.length, 1);
  }
});

test("null order and precision-lost numeric IDs are not accepted", async () => {
  for (const [value, code] of [
    [null, "ORDER_UNAVAILABLE"],
    [
      order({ legacyResourceId: 9007199254740992 }),
      "ORDER_IDENTITY_UNAVAILABLE",
    ],
  ] as const) {
    const mock = scripted([
      authResponse(),
      response({ data: { order: value } }),
    ]);
    await assert.rejects(fetchOrderSnapshot(mock.graphql, id, shop), {
      message: code,
    });
  }
});

test("changed revisions retry from first page and stop after three attempts", async () => {
  const unstable = () =>
    response({ data: { order: { id, updatedAt: "2026-09-29T12:01:00Z" } } });
  const recovered = scripted([
    authResponse(),
    response({ data: { order: order() } }),
    unstable(),
    response({ data: { order: order() } }),
    revisionResponse(),
  ]);
  assert.equal((await fetchOrderSnapshot(recovered.graphql, id, shop)).id, id);
  const responses = [authResponse()];
  for (let i = 0; i < 3; i++)
    responses.push(response({ data: { order: order() } }), unstable());
  const mock = scripted(responses);
  await assert.rejects(fetchOrderSnapshot(mock.graphql, id, shop), {
    message: "REVISION_UNSTABLE",
  });
  assert.equal(mock.calls.length, 7);
});

test("missing and repeated cursors cannot pretend pagination completed", async () => {
  const page = (cursor: string | null) =>
    response({
      data: {
        order: order({
          lineItems: {
            nodes: [],
            pageInfo: { hasNextPage: true, endCursor: cursor },
          },
        }),
      },
    });
  for (const pages of [[page(null)], [page("same"), page("same")]]) {
    const mock = scripted([authResponse(), ...pages]);
    await assert.rejects(fetchOrderSnapshot(mock.graphql, id, shop), {
      message: "PAGINATION_INCOMPLETE",
    });
  }
});

test("SDK-wrapped upstream version is verified without inventing a missing version", async () => {
  const sdk = (data: unknown, headers: Record<string, unknown>) =>
    Response.json({ data, headers });
  const mock = scripted([
    sdk(authority, { "X-Shopify-Api-Version": ["2026-07"] }),
    sdk({ order: order() }, { "x-shopify-api-version": "2026-07" }),
    sdk(
      { order: { id, updatedAt: revision } },
      { "X-Shopify-API-Version": "2026-07" },
    ),
  ]);
  assert.equal((await fetchOrderSnapshot(mock.graphql, id, shop)).id, id);
  for (const headers of [{}, { "x-shopify-api-version": "2026-04" }]) {
    const missing = scripted([sdk(authority, headers)]);
    await assert.rejects(fetchOrderSnapshot(missing.graphql, id, shop), {
      message: "API_VERSION_UNVERIFIED",
    });
  }
});
