import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluateHighLineQuantity, validateHighLineQuantitySettings } from "../app/rules/high-line-quantity";
import { evaluateHighOrderValue } from "../app/rules/high-order-value";
import { RuleAuthorizationError, RuleConfigurationError, type EvaluationContext, type RuleOrderInput } from "../app/rules/contracts";

type Input = {
  context: EvaluationContext;
  order: RuleOrderInput & { lines: unknown } & Record<string, unknown>;
  settings: Record<string, unknown> | null;
};
type Fixture = { id: string; input: Input; expected: { ruleKey: string; [key: string]: unknown } };
const fixtures = JSON.parse(readFileSync(new URL("../docs/fixtures/rules-v1.json", import.meta.url), "utf8")) as { cases: Fixture[] };
const quantityFixtures = fixtures.cases.filter((fixture) => fixture.expected.ruleKey === "high_line_quantity");
const base = () => structuredClone(quantityFixtures.find((fixture) => fixture.id === "Q_ABOVE")!.input);
const settings = () => ({ ...base().settings! });
const shopId = "synthetic-shop-a";
const line = (id: number, currentQuantity: unknown) => ({ id: `gid://shopify/LineItem/${id}`, currentQuantity });
function deepFreeze(value: unknown): void {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
}
function expectResult(input: Input, outcome: string, reasonCode: string) {
  const result = evaluateHighLineQuantity(input);
  assert.equal(result.outcome, outcome);
  assert.equal(result.reasonCode, reasonCode);
  return result;
}

for (const fixture of quantityFixtures) {
  test(`P05 quantity acceptance: ${fixture.id}; immutable and deterministic`, () => {
    const input = structuredClone(fixture.input);
    const before = structuredClone(input);
    deepFreeze(input);
    assert.deepEqual(evaluateHighLineQuantity(input), fixture.expected);
    assert.deepEqual(evaluateHighLineQuantity(input), fixture.expected);
    assert.deepEqual(input, before);
  });
}

test("configuration boundary accepts explicit positive safe integer and has no default threshold", () => {
  for (const threshold of [1, 5, Number.MAX_SAFE_INTEGER]) {
    const candidate = { ...settings(), threshold };
    deepFreeze(candidate);
    const validated = validateHighLineQuantitySettings(shopId, candidate);
    assert.deepEqual(validated, candidate);
    assert.ok(Object.isFrozen(validated));
  }
  const absent = settings();
  delete absent.threshold;
  assert.throws(() => validateHighLineQuantitySettings(shopId, absent), RuleConfigurationError);
});

test("configuration boundary rejects invalid thresholds without coercion", () => {
  for (const threshold of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "5", "", null, undefined, true]) {
    assert.throws(() => validateHighLineQuantitySettings(shopId, { ...settings(), threshold }), RuleConfigurationError);
    const input = base();
    input.settings!.threshold = threshold;
    expectResult(input, "unknown", "INVALID_CONFIGURATION");
  }
});

test("configuration boundary validates enabled, version and rule key and strips unrelated fields", () => {
  for (const mutation of [{ enabled: "true" }, { enabled: 1 }, { settingsVersion: "" }, { settingsVersion: "bad version" }, { settingsVersion: "version\n" }, { settingsVersion: "v".repeat(129) }, { ruleKey: "high_order_value" }]) {
    assert.throws(() => validateHighLineQuantitySettings(shopId, { ...settings(), ...mutation }), RuleConfigurationError);
  }
  assert.deepEqual(validateHighLineQuantitySettings(shopId, { ...settings(), unrelated: "synthetic metadata" }), settings());
});

test("foreign order and settings fail before evidence, including disabled settings", () => {
  assert.throws(() => validateHighLineQuantitySettings(shopId, { ...settings(), shopId: "synthetic-shop-b" }), RuleAuthorizationError);
  for (const target of ["order", "settings"] as const) {
    const input = base();
    input[target]!.shopId = "synthetic-shop-b";
    assert.throws(() => evaluateHighLineQuantity(input), RuleAuthorizationError);
    input.settings!.enabled = false;
    assert.throws(() => evaluateHighLineQuantity(input), RuleAuthorizationError);
  }
});

test("all matching lines are sorted, minimal evidence without SKU aggregation or customer fields", () => {
  const input = base();
  input.order.lines = { available: true, value: [
    { ...line(302, 7), sku: "SYNTHETIC-SAME", title: "Do not copy" },
    { ...line(301, 6), sku: "SYNTHETIC-SAME", customer: "Do not copy" },
    line(303, 5),
  ] };
  assert.deepEqual(expectResult(input, "matched", "ABOVE_THRESHOLD").evidence, {
    kind: "lines", threshold: 5, matchingLines: [line(301, 6), line(302, 7)],
  });
  input.order.lines = { available: true, value: [
    { ...line(301, 3), sku: "SYNTHETIC-SAME" }, { ...line(302, 3), sku: "SYNTHETIC-SAME" },
  ] };
  expectResult(input, "not_matched", "AT_OR_BELOW_THRESHOLD");
});

test("missing lines, quantities and incomplete pages remain unknown even with an apparent match", () => {
  for (const lines of [undefined, null, { available: false, reason: "ACCESS_DENIED", value: [line(301, 6)] }, { available: true }, { available: true, value: [line(301, 6), { id: "gid://shopify/LineItem/302" }] }]) {
    const input = base();
    input.order.lines = lines;
    expectResult(input, "unknown", "LINES_UNAVAILABLE");
  }
});

test("invalid quantity, duplicate or malformed line identity never yields safe or matched", () => {
  for (const lines of [
    ...[-1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "6"].map((quantity) => [line(301, quantity)]),
    [line(301, 6), line(301, 1)],
    [{ id: "", currentQuantity: 6 }],
    [{ id: "not-a-shopify-line", currentQuantity: 6 }],
    [null],
  ]) {
    const input = base();
    input.order.lines = { available: true, value: lines };
    expectResult(input, "unknown", "INVALID_DATA");
  }
});

test("refund uses authoritative currentQuantity once and fulfillment status is not an exclusion", () => {
  const input = base();
  input.order.financialStatus = "REFUNDED";
  input.order.fulfillmentStatus = "PARTIALLY_FULFILLED";
  input.order.lines = { available: true, value: [{ ...line(301, 6), refundedQuantity: 2, unfulfilledQuantity: 0 }] };
  expectResult(input, "matched", "ABOVE_THRESHOLD");
  input.order.lines = { available: true, value: [{ ...line(301, 4), refundedQuantity: 2 }] };
  input.order.sourceSnapshotVersion = "synthetic-after-refund";
  assert.equal(expectResult(input, "not_matched", "AT_OR_BELOW_THRESHOLD").sourceSnapshotVersion, "synthetic-after-refund");
  input.order.lines = { available: true, value: [] };
  expectResult(input, "not_matched", "EMPTY_LINES");
});

test("known lifecycle exclusions precede missing lines and invalid threshold", () => {
  const input = base();
  input.order.lines = { available: false, reason: "ACCESS_DENIED" };
  input.settings!.threshold = "invalid";
  input.order.cancelledAt = { available: true, value: "2026-01-02T13:00:00Z" };
  expectResult(input, "not_applicable", "ORDER_CANCELLED");
  input.order.cancelledAt = { available: false, reason: "ACCESS_DENIED" };
  input.context.active = false;
  expectResult(input, "not_applicable", "INACTIVE_INSTALLATION");
});

test("two shops retain distinct settings and versions for identical line quantities", () => {
  const a = base();
  const b = base();
  b.context.shopId = "synthetic-shop-b";
  b.order.shopId = "synthetic-shop-b";
  b.settings = { ...b.settings, shopId: "synthetic-shop-b", threshold: 10, settingsVersion: "shop-b-2" };
  assert.equal(expectResult(a, "matched", "ABOVE_THRESHOLD").settingsVersion, "settings-1");
  assert.equal(expectResult(b, "not_matched", "AT_OR_BELOW_THRESHOLD").settingsVersion, "shop-b-2");
});

test("both V1 rules evaluate one immutable snapshot: both match and neither matches", () => {
  for (const [amount, currentQuantity, expected] of [["100.01", 6, "matched"], ["100.00", 5, "not_matched"]] as const) {
    const input = base();
    input.order.total = { available: true, value: { amount, currencyCode: "CAD" } };
    input.order.lines = { available: true, value: [line(301, currentQuantity)] };
    deepFreeze(input);
    const quantity = evaluateHighLineQuantity(input);
    const value = evaluateHighOrderValue({ ...input, settings: { shopId, ruleKey: "high_order_value", enabled: true, threshold: "100.00", currencyCode: "CAD", settingsVersion: "value-settings-2" } });
    assert.equal(quantity.outcome, expected);
    assert.equal(value.outcome, expected);
    assert.equal(quantity.sourceSnapshotVersion, value.sourceSnapshotVersion);
    assert.equal(quantity.evaluatedAt, value.evaluatedAt);
    assert.equal(quantity.ruleVersion, "1.0.0");
    assert.equal(value.ruleVersion, "1.0.0");
    assert.equal(quantity.settingsVersion, "settings-1");
    assert.equal(value.settingsVersion, "value-settings-2");
  }
});

test("one rule's unavailable fields do not suppress the other rule", () => {
  const input = base();
  input.order.total = { available: true, value: { amount: "100.01", currencyCode: "CAD" } };
  input.order.lines = { available: false, reason: "ACCESS_DENIED" };
  expectResult(input, "unknown", "LINES_UNAVAILABLE");
  const valueSettings = { shopId, ruleKey: "high_order_value", enabled: true, threshold: "100.00", currencyCode: "CAD", settingsVersion: "value-1" };
  assert.equal(evaluateHighOrderValue({ ...input, settings: valueSettings }).outcome, "matched");
  input.order.total = { available: false, reason: "ACCESS_DENIED" };
  input.order.lines = { available: true, value: [line(301, 6)] };
  expectResult(input, "matched", "ABOVE_THRESHOLD");
  assert.equal(evaluateHighOrderValue({ ...input, settings: valueSettings }).outcome, "unknown");
});
