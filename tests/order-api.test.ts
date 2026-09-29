import assert from "node:assert/strict";
import { test } from "node:test";
import { createOrderApi, OrderApiError } from "../app/order-api.server";

const headers = { "X-Shopify-API-Version": "2026-07" };
const response = (body: unknown, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
const cost = { cost: { requestedQueryCost: 100, throttleStatus: { currentlyAvailable: 0, restoreRate: 50 } } };
function clock() {
  let time = 0;
  const waits: number[] = [];
  return { now: () => time, waits, sleep: async (ms: number) => { waits.push(ms); time += ms; } };
}
test("direct and SDK wrapped headers verify pinned version", async () => {
  for (const result of [response({ data: { order: null } }), new Response(JSON.stringify({ headers: { "x-shopify-api-version": ["2026-07"] }, data: { order: null } }))]) {
    assert.deepEqual(await createOrderApi(async () => result).request("query"), { order: null });
  }
  await assert.rejects(createOrderApi(async () => new Response(JSON.stringify({ data: {} }))).request("query"), /API_VERSION_UNVERIFIED/);
  await assert.rejects(createOrderApi(async () => response({ data: {} }, 200, { "X-Shopify-API-Version": "2026-10" })).request("query"), /API_VERSION_UNVERIFIED/);
});
test("HTTP 200 partial errors are never accepted or leaked", async () => {
  let calls = 0;
  const api = createOrderApi(async () => { calls++; return response({ data: { order: { id: "private" } }, errors: [{ message: "secret payload", extensions: { code: "ACCESS_DENIED" } }] }); });
  await assert.rejects(api.request("query"), error => error instanceof OrderApiError && error.message === "API_QUERY_FAILED");
  assert.equal(calls, 1);
});
test("HTTP 429 respects Retry-After and recovers", async () => {
  const timing = clock(); let calls = 0;
  const api = createOrderApi(async () => ++calls === 1 ? response({}, 429, { "Retry-After": "3" }) : response({ data: { ok: true } }), timing);
  assert.deepEqual(await api.request("query"), { ok: true });
  assert.deepEqual(timing.waits, [3000]);
});
test("SDK thrown GraphQL throttling uses body and cost metadata", async () => {
  const timing = clock(); let calls = 0;
  const api = createOrderApi(async () => {
    if (++calls === 1) throw Object.assign(new Error("private upstream message"), {
      response: { status: 200 }, headers, body: { errors: { graphQLErrors: [{ extensions: { code: "THROTTLED" } }] }, extensions: cost },
    });
    return response({ data: { ok: true } });
  }, timing);
  await api.request("query");
  assert.deepEqual(timing.waits, [2000]);
});
test("successful cost metadata paces the next request", async () => {
  const timing = clock(); let calls = 0;
  const api = createOrderApi(async () => response({ data: {}, ...(++calls === 1 ? { extensions: cost } : {}) }), timing);
  await Promise.all([api.request("first"), api.request("second")]);
  assert.deepEqual(timing.waits, [2000]);
});
test("long throttle is deferred without an early retry", async () => {
  const timing = clock(); let calls = 0;
  const api = createOrderApi(async () => { calls++; return response({}, 429, { "Retry-After": "60" }); }, timing);
  await assert.rejects(api.request("query"), error => error instanceof OrderApiError && error.retryAfterMs === 60000);
  assert.equal(calls, 1); assert.deepEqual(timing.waits, []);
});
test("network and server failures have bounded backoff, no upstream text", async () => {
  for (const kind of ["network", "http", "sdk"]) {
    const timing = clock(); let calls = 0;
    const api = createOrderApi(async () => {
      calls++;
      if (kind === "network") throw new Error("secret");
      if (kind === "sdk") throw Object.assign(new Error("secret"), { response: { code: 503, headers, body: {} } });
      return response({}, 503);
    }, timing);
    await assert.rejects(api.request("query"), /API_UNAVAILABLE/);
    assert.equal(calls, 3); assert.deepEqual(timing.waits, [1000, 2000]);
  }
});
test("invalid JSON, absent data and malformed errors cannot pass", async () => {
  for (const result of [new Response("not json", { headers }), response({}), response({ data: {}, errors: {} }), response({ data: [] })]) {
    await assert.rejects(createOrderApi(async () => result).request("query"), /API_RESPONSE_INVALID|API_QUERY_FAILED/);
  }
});
