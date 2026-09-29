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
export type OrderGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

export class SnapshotError extends Error {
  constructor(public readonly code: string) {
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
    const response = await graphql(query, { variables });
    if (!response.ok) throw new SnapshotError("API_UNAVAILABLE");
    const body = object(await response.json());
    // React Router SDK wraps the API result in a fresh Response and retains
    // upstream headers in body.headers (not Response.headers).
    const sdkHeaders = object(body.headers);
    const sdkVersion = Object.entries(sdkHeaders).find(
      ([name]) => name.toLowerCase() === "x-shopify-api-version",
    )?.[1];
    const version =
      response.headers.get("X-Shopify-API-Version") ??
      (Array.isArray(sdkVersion) && sdkVersion.length === 1
        ? sdkVersion[0]
        : sdkVersion);
    if (version !== "2026-07")
      throw new SnapshotError("API_VERSION_UNVERIFIED");
    if (
      body.errors !== undefined &&
      (!Array.isArray(body.errors) || body.errors.length)
    )
      throw new SnapshotError("GRAPHQL_UNAVAILABLE");
    if (!body.data) throw new SnapshotError("API_UNAVAILABLE");
    return object(body.data);
  } catch (error) {
    if (error instanceof SnapshotError) throw error;
    // Do not retain SDK errors, request details, raw responses or token-bearing causes.
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
        : { available: true, value: lines };
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
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await snapshotAttempt(graphql, orderId);
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
