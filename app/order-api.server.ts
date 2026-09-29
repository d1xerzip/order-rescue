// Read-only Admin API transport. Never propagate upstream messages or payloads.
export type OrderApiGraphql = (query: string, options?: {
  variables?: Record<string, unknown>;
}) => Promise<Response>;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ObjectValue : {};
export class OrderApiError extends Error {
  constructor(public readonly code: string, public readonly retryAfterMs?: number) {
    super(code);
    this.name = "OrderApiError";
  }
}
function header(headers: unknown, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const value = Object.entries(object(headers)).find(([key]) => key.toLowerCase() === name)?.[1];
  const scalar = Array.isArray(value) && value.length === 1 ? value[0] : value;
  return typeof scalar === "string" ? scalar : undefined;
}
function retryAfter(headers: unknown, now: number): number {
  const raw = header(headers, "retry-after");
  if (!raw) return 0;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
    : Math.max(0, (Date.parse(raw) || now) - now);
}
function costWait(body: ObjectValue): number {
  const cost = object(object(body.extensions).cost);
  const throttle = object(cost.throttleStatus);
  const needed = cost.requestedQueryCost;
  const available = throttle.currentlyAvailable;
  const rate = throttle.restoreRate;
  if (typeof needed !== "number" || typeof available !== "number" ||
      typeof rate !== "number" || ![needed, available, rate].every(Number.isFinite) ||
      needed < 0 || available < 0 || rate <= 0) return 0;
  return Math.ceil(Math.max(0, needed - available) / rate * 1000);
}
export function createOrderApi(graphql: OrderApiGraphql, options: {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxAttempts?: number;
  maxWaitMs?: number;
} = {}) {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const attempts = Math.min(3, Math.max(1, options.maxAttempts ?? 3));
  const maxWait = Math.min(10_000, Math.max(0, options.maxWaitMs ?? 5_000));
  let nextRequestAt = 0;
  // A client belongs to one shop and serializes its own requests. Cross-worker
  // throttles still receive bounded retries; this is not a global rate limiter.
  let tail: Promise<unknown> = Promise.resolve();
  async function run(query: string, variables?: ObjectValue): Promise<ObjectValue> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const pause = Math.max(0, nextRequestAt - now());
      if (pause > maxWait) throw new OrderApiError("API_THROTTLED", pause);
      if (pause) await sleep(pause);
      let status = 0;
      let body: ObjectValue = {};
      let headers: unknown;
      let thrown = false;
      try {
        const response = await graphql(query, { variables });
        status = response.status;
        headers = response.headers;
        try { body = object(await response.json()); } catch { /* Invalid JSON is never success. */ }
      } catch (error) {
        thrown = true;
        const failure = object(error);
        const response = object(failure.response);
        status = Number(response.status ?? response.code) || 0;
        body = object(failure.body ?? response.body);
        headers = failure.headers ?? response.headers;
      }
      const wait = Math.max(costWait(body), retryAfter(headers, now()), retryAfter(body.headers, now()));
      const errors = Array.isArray(body.errors) ? body.errors : object(body.errors).graphQLErrors;
      const codes = Array.isArray(errors) ? errors.map(error => object(object(error).extensions).code) : [];
      const hasErrors = body.errors !== undefined && !(Array.isArray(body.errors) && body.errors.length === 0);
      const transientGraphql = codes.length > 0 && codes.every(code => code === "THROTTLED" || code === "INTERNAL_SERVER_ERROR");
      const retryable = status === 0 || status === 429 || status >= 500 || transientGraphql;
      if (retryable) {
        const delay = Math.max(wait, 1000 * 2 ** attempt);
        nextRequestAt = now() + delay;
        const code = status === 429 || codes.includes("THROTTLED") ? "API_THROTTLED" : "API_UNAVAILABLE";
        if (attempt + 1 === attempts || delay > maxWait) throw new OrderApiError(code, delay);
        continue;
      }
      if (status < 200 || status >= 300) throw new OrderApiError("API_UNAVAILABLE");
      const version = header(headers, "x-shopify-api-version") ?? header(body.headers, "x-shopify-api-version");
      if (version !== "2026-07") throw new OrderApiError("API_VERSION_UNVERIFIED");
      if (hasErrors || thrown) throw new OrderApiError("API_QUERY_FAILED");
      if (body.data === null || typeof body.data !== "object" || Array.isArray(body.data))
        throw new OrderApiError("API_RESPONSE_INVALID");
      nextRequestAt = now() + wait;
      return body.data as ObjectValue;
    }
    throw new OrderApiError("API_UNAVAILABLE");
  }
  return {
    request(query: string, variables?: ObjectValue): Promise<ObjectValue> {
      const result = tail.then(() => run(query, variables));
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
export function readOrderApi(graphql: OrderApiGraphql, query: string, variables?: ObjectValue) {
  return createOrderApi(graphql).request(query, variables);
}
