import { OrderApiError, type OrderApiGraphql } from "./order-api.server";
import { orderReader } from "./order-reader.server";
// Admin API 2026-07. Only the inventory in docs/ARCHITECTURE.md is selected.
export type Availability<T> =
  { available: true; value: T } | { available: false; reason: string };

export type OrderSnapshot = {
  id: string;
  legacyResourceId: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: Availability<string | null>;
  total: Availability<{ amount: string; currencyCode: string }>;
  lines: Availability<Array<{ id: string; currentQuantity: number }>>;
};
export type OrderGraphql = OrderApiGraphql;

export class SnapshotError extends Error {
  constructor(public readonly code: string, public readonly retryAfterMs?: number) {
    super(code);
    this.name = "SnapshotError";
  }
}

const IDENTITY_QUERY = `#graphql
  query P03OrderAuthority {
    shop { id myshopifyDomain }
    currentAppInstallation { accessScopes { handle } }
  }`;
const ORDER_QUERY = `#graphql
  query P03OrderSnapshot($id: ID!, $after: String) {
    order(id: $id) {
      id legacyResourceId createdAt updatedAt cancelledAt
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 100, after: $after) {
        nodes { id currentQuantity }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;
const REVISION_QUERY = `#graphql
  query P03OrderRevision($id: ID!) { order(id: $id) { id updatedAt } }`;

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}
const unavailable = (reason: string): Availability<never> => ({
  available: false,
  reason,
});

async function request(
  graphql: OrderGraphql,
  query: string,
  variables?: Record<string, unknown>,
): Promise<ObjectValue> {
  try {
    return await orderReader(graphql).request(query, variables);
  } catch (error) {
    if (error instanceof OrderApiError)
      throw new SnapshotError(error.code === "API_QUERY_FAILED" ? "GRAPHQL_UNAVAILABLE" : error.code, error.retryAfterMs);
    throw new SnapshotError("API_UNAVAILABLE");
  }
}

async function snapshotAttempt(
  graphql: OrderGraphql,
  orderId: string,
): Promise<OrderSnapshot> {
  const lines: Array<{ id: string; currentQuantity: number }> = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let after: string | null = null;
  let result: OrderSnapshot | undefined;
  let linesInvalid = false;
  for (let page = 0; page < 100; page++) {
    const data = await request(graphql, ORDER_QUERY, { id: orderId, after });
    const order = object(data.order);
    if (order.id !== orderId) throw new SnapshotError("ORDER_UNAVAILABLE");
    if (!timestamp(order.updatedAt))
      throw new SnapshotError("REVISION_UNAVAILABLE");
    if (result && order.updatedAt !== result.updatedAt)
      throw new SnapshotError("REVISION_CHANGED");
    if (!result) {
      if (
        !timestamp(order.createdAt) ||
        typeof order.legacyResourceId !== "string" ||
        !/^[1-9]\d*$/.test(order.legacyResourceId) ||
        orderId !== `gid://shopify/Order/${order.legacyResourceId}`
      )
        throw new SnapshotError("ORDER_IDENTITY_UNAVAILABLE");
      const money = object(object(order.currentTotalPriceSet).shopMoney);
      result = {
        id: orderId,
        legacyResourceId: order.legacyResourceId,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        cancelledAt:
          order.cancelledAt === null || timestamp(order.cancelledAt)
            ? { available: true, value: order.cancelledAt as string | null }
            : unavailable("CANCELLATION_UNAVAILABLE"),
        total:
          typeof money.amount === "string" &&
          /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(money.amount) &&
          typeof money.currencyCode === "string" &&
          /^[A-Z]{3}$/.test(money.currencyCode)
            ? {
                available: true,
                value: {
                  amount: money.amount,
                  currencyCode: money.currencyCode,
                },
              }
            : unavailable("TOTAL_UNAVAILABLE"),
        lines: unavailable("LINES_UNAVAILABLE"),
      };
    }
    const connection = object(order.lineItems);
    const pageInfo = object(connection.pageInfo);
    if (
      !Array.isArray(connection.nodes) ||
      typeof pageInfo.hasNextPage !== "boolean"
    ) {
      linesInvalid = true;
    } else {
      for (const node of connection.nodes) {
        const line = object(node);
        if (
          typeof line.id !== "string" ||
          !/^gid:\/\/shopify\/LineItem\/[1-9]\d*$/.test(line.id) ||
          !Number.isSafeInteger(line.currentQuantity) ||
          (line.currentQuantity as number) < 0 ||
          ids.has(line.id)
        ) {
          linesInvalid = true;
          continue;
        }
        ids.add(line.id);
        lines.push({
          id: line.id,
          currentQuantity: line.currentQuantity as number,
        });
      }
    }
    if (linesInvalid || pageInfo.hasNextPage === false) {
      const final = object(
        (await request(graphql, REVISION_QUERY, { id: orderId })).order,
      );
      if (final.id !== orderId) throw new SnapshotError("ORDER_UNAVAILABLE");
      if (final.updatedAt !== result.updatedAt)
        throw new SnapshotError("REVISION_CHANGED");
      result.lines = linesInvalid
        ? unavailable("LINES_UNAVAILABLE")
        : { available: true, value: lines.sort((a, b) => a.id.localeCompare(b.id)) };
      return result;
    }
    if (
      typeof pageInfo.endCursor !== "string" ||
      !pageInfo.endCursor ||
      cursors.has(pageInfo.endCursor)
    )
      throw new SnapshotError("PAGINATION_INCOMPLETE");
    cursors.add(pageInfo.endCursor);
    after = pageInfo.endCursor;
  }
  throw new SnapshotError("PAGINATION_LIMIT");
}

export async function fetchOrderSnapshot(
  graphql: OrderGraphql,
  orderId: string,
  expectedShop: { shopifyId: string; domain: string },
): Promise<OrderSnapshot> {
  if (!/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(orderId))
    throw new SnapshotError("INVALID_ORDER_ID");
  await verifyOrderAuthority(graphql, expectedShop);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const first = await snapshotAttempt(graphql, orderId);
      const second = await snapshotAttempt(graphql, orderId);
      // updatedAt is not a unique revision. Compare every approved field,
      // including all line pages, even when both timestamps are identical.
      if (JSON.stringify(first) !== JSON.stringify(second))
        throw new SnapshotError("REVISION_CHANGED");
      return second;
    } catch (error) {
      if (
        !(error instanceof SnapshotError) ||
        error.code !== "REVISION_CHANGED"
      )
        throw error;
    }
  }
  throw new SnapshotError("REVISION_UNSTABLE");
}

export async function verifyOrderAuthority(
  graphql: OrderGraphql,
  expectedShop: { shopifyId: string; domain: string },
): Promise<void> {
  const authority = await request(graphql, IDENTITY_QUERY);
  const shop = object(authority.shop);
  if (
    shop.id !== expectedShop.shopifyId ||
    shop.myshopifyDomain !== expectedShop.domain
  )
    throw new SnapshotError("SHOP_IDENTITY_MISMATCH");
  const scopes = object(authority.currentAppInstallation).accessScopes;
  if (
    !Array.isArray(scopes) ||
    !scopes.some((scope) => object(scope).handle === "read_orders")
  )
    throw new SnapshotError("ORDER_SCOPE_MISSING");
}

const DISCOVERY_QUERY = `#graphql
  query P04OrderDiscovery($filter: String!, $after: String) {
    orders(first: 50, after: $after, sortKey: CREATED_AT, query: $filter) {
      nodes { id createdAt updatedAt }
      pageInfo { hasNextPage endCursor }
    }
  }`;
export async function fetchOrderPage(
  graphql: OrderGraphql,
  expectedShop: { shopifyId: string; domain: string },
  window: { from: Date; to: Date; after?: string | null },
): Promise<{
  orders: Array<{ id: string; createdAt: string; updatedAt: string }>;
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  const from = window.from.getTime(), to = window.to.getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to)
    throw new SnapshotError("INVALID_SYNC_WINDOW");
  await verifyOrderAuthority(graphql, expectedShop);
  // Broaden search to whole seconds; apply exact inclusive bounds locally.
  // Retain server pageInfo even when every node on this page is filtered out.
  const lower = new Date(Math.floor(from / 1000) * 1000).toISOString();
  const upper = new Date(Math.ceil(to / 1000) * 1000).toISOString();
  const data = await request(graphql, DISCOVERY_QUERY, {
    filter: `created_at:>='${lower}' created_at:<='${upper}'`,
    after: window.after ?? null,
  });
  const connection = object(data.orders), page = object(connection.pageInfo);
  if (!Array.isArray(connection.nodes) || typeof page.hasNextPage !== "boolean" ||
      !(page.endCursor === null || typeof page.endCursor === "string") ||
      (page.hasNextPage && (!page.endCursor || page.endCursor === window.after)))
    throw new SnapshotError("PAGINATION_INCOMPLETE");
  const orders: Array<{ id: string; createdAt: string; updatedAt: string }> = [];
  const ids = new Set<string>();
  for (const node of connection.nodes) {
    const order = object(node);
    if (typeof order.id !== "string" || !/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(order.id) ||
        !timestamp(order.createdAt) || !timestamp(order.updatedAt) || ids.has(order.id))
      throw new SnapshotError("ORDER_IDENTITY_UNAVAILABLE");
    ids.add(order.id);
    const created = Date.parse(order.createdAt);
    if (created >= from && created <= to)
      orders.push({ id: order.id, createdAt: order.createdAt, updatedAt: order.updatedAt });
  }
  return { orders, hasNextPage: page.hasNextPage, endCursor: page.endCursor as string | null };
}
