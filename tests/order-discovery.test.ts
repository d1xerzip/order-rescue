import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchOrderPage, SnapshotError } from "../app/order-snapshot.server";
import type { OrderApiGraphql } from "../app/order-api.server";
const shop = { shopifyId: "gid://shopify/Shop/1", domain: "synthetic.myshopify.com" };
const authority = { shop: { id: shop.shopifyId, myshopifyDomain: shop.domain }, currentAppInstallation: { accessScopes: [{ handle: "read_orders" }] } };
const from = new Date("2026-09-29T12:00:00.123Z"), to = new Date("2026-09-29T12:01:00.456Z");
const node = (id: number, createdAt: string) => ({ id: `gid://shopify/Order/${id}`, createdAt, updatedAt: createdAt });
const response = (data: unknown) => Response.json({ data }, { headers: { "X-Shopify-API-Version": "2026-07" } });
test("inclusive exact boundaries with broad whole-second query preserve IDs and fields", async () => {
  const nodes = [node(1, "2026-09-29T12:00:00.122Z"), node(2, from.toISOString()), node(3, to.toISOString()), node(4, "2026-09-29T12:01:00.457Z")];
  const graphql: OrderApiGraphql = async (query, options) => {
    if (query.includes("P03OrderAuthority")) return response(authority);
    assert.match(query, /first: 50/); assert.match(query, /sortKey: CREATED_AT/);
    assert.deepEqual(options?.variables, { filter: "created_at:>='2026-09-29T12:00:00.000Z' created_at:<='2026-09-29T12:01:01.000Z'", after: "previous" });
    return response({ orders: { nodes, pageInfo: { hasNextPage: true, endCursor: "next" } } });
  };
  assert.deepEqual(await fetchOrderPage(graphql, shop, { from, to, after: "previous" }), { orders: nodes.slice(1, 3), hasNextPage: true, endCursor: "next" });
});
test("filtered empty page still resumes using the actual server cursor", async () => {
  const graphql: OrderApiGraphql = async query => response(query.includes("P03OrderAuthority") ? authority : { orders: { nodes: [node(1, "2026-09-29T12:00:00.122Z")], pageInfo: { hasNextPage: true, endCursor: "next" } } });
  assert.deepEqual(await fetchOrderPage(graphql, shop, { from, to }), { orders: [], hasNextPage: true, endCursor: "next" });
});
test("missing connection, malformed identity and repeated cursor are failures", async () => {
  for (const orders of [null, { nodes: [node(1, "invalid")], pageInfo: { hasNextPage: false, endCursor: null } }, { nodes: [], pageInfo: { hasNextPage: true, endCursor: "previous" } }]) {
    const graphql: OrderApiGraphql = async query => response(query.includes("P03OrderAuthority") ? authority : { orders });
    await assert.rejects(fetchOrderPage(graphql, shop, { from, to, after: "previous" }), /PAGINATION_INCOMPLETE|ORDER_IDENTITY_UNAVAILABLE/);
  }
});
test("foreign shop and partial GraphQL errors never return a discovery page", async () => {
  let calls = 0;
  const foreign: OrderApiGraphql = async () => { calls++; return response({ ...authority, shop: { id: "gid://shopify/Shop/2", myshopifyDomain: shop.domain } }); };
  await assert.rejects(fetchOrderPage(foreign, shop, { from, to }), /SHOP_IDENTITY_MISMATCH/);
  assert.equal(calls, 1);
  const partial: OrderApiGraphql = async query => query.includes("P03OrderAuthority") ? response(authority) : Response.json({ data: { orders: { nodes: [] } }, errors: [{ message: "private" }] }, { headers: { "X-Shopify-API-Version": "2026-07" } });
  await assert.rejects(fetchOrderPage(partial, shop, { from, to }), /GRAPHQL_UNAVAILABLE/);
});
test("long API throttle retains safe durable retry delay", async () => {
  const graphql: OrderApiGraphql = async () => new Response("{}", { status: 429, headers: { "Retry-After": "60" } });
  await assert.rejects(fetchOrderPage(graphql, shop, { from, to }), error => error instanceof SnapshotError && error.code === "API_THROTTLED" && error.retryAfterMs === 60000);
});
