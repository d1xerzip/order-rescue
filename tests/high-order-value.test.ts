import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  evaluateHighOrderValue,
  validateHighOrderValueSettings,
} from "../app/rules/high-order-value";
import {
  RuleAuthorizationError,
  RuleConfigurationError,
  type EvaluationContext,
  type RuleOrderInput,
} from "../app/rules/contracts";

type Input = {
  context: EvaluationContext;
  order: RuleOrderInput & Record<string, unknown>;
  settings: Record<string, unknown> | null;
};
type Fixture = {
  id: string;
  input: Input;
  expected: { ruleKey: string; [key: string]: unknown };
};
const fixtures = JSON.parse(
  readFileSync(new URL("../docs/fixtures/rules-v1.json", import.meta.url), "utf8"),
) as { cases: Fixture[] };
const valueFixtures = fixtures.cases.filter(
  (fixture) => fixture.expected.ruleKey === "high_order_value",
);
const base = () => structuredClone(valueFixtures.find((value) => value.id === "V_ABOVE")!.input);
const settings = () => ({ ...base().settings! });
const shopId = "synthetic-shop-a";

function deepFreeze(value: unknown): void {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
}
function amount(input: Input, value: unknown, currencyCode: unknown = "CAD") {
  input.order.total = { available: true, value: { amount: value, currencyCode } };
}
function outcome(input: Input, expectedOutcome: string, reasonCode: string) {
  const result = evaluateHighOrderValue(input);
  assert.equal(result.outcome, expectedOutcome);
  assert.equal(result.reasonCode, reasonCode);
  return result;
}

for (const fixture of valueFixtures) {
  test(`P05 acceptance: ${fixture.id}; immutable input and deterministic result`, () => {
    const input = structuredClone(fixture.input);
    const before = structuredClone(input);
    deepFreeze(input);
    assert.deepEqual(evaluateHighOrderValue(input), fixture.expected);
    assert.deepEqual(evaluateHighOrderValue(input), fixture.expected);
    assert.deepEqual(input, before);
  });
}

test("configuration boundary accepts explicit exact threshold and produces no merchant default", () => {
  for (const threshold of ["0", "0.00", "100.000", "90071992547409931234567890.0000000001"]) {
    const candidate = { ...settings(), threshold };
    const before = structuredClone(candidate);
    deepFreeze(candidate);
    assert.deepEqual(validateHighOrderValueSettings(shopId, candidate), before);
    assert.deepEqual(candidate, before);
  }
  const missingThreshold = settings();
  delete missingThreshold.threshold;
  assert.throws(() => validateHighOrderValueSettings(shopId, missingThreshold), RuleConfigurationError);
});

for (const threshold of ["", "-1", "+1", "01", ".1", "1.", "1e2", "1,000", "NaN", "Infinity", " 100", "100 ", "100\n", 100, null, undefined]) {
  test(`configuration boundary rejects invalid threshold ${JSON.stringify(threshold)}`, () => {
    assert.throws(() => validateHighOrderValueSettings(shopId, { ...settings(), threshold }), RuleConfigurationError);
  });
}

test("configuration boundary rejects invalid enabled flag, version, currency and rule identity", () => {
  const invalid = [
    { enabled: "true" },
    { enabled: 1 },
    { enabled: null },
    { settingsVersion: "" },
    { settingsVersion: "version with spaces" },
    { settingsVersion: "valid-looking\n" },
    { settingsVersion: "x".repeat(129) },
    { settingsVersion: null },
    { currencyCode: "ZZZ" },
    { currencyCode: "cad" },
    { currencyCode: "XXX" },
    { currencyCode: null },
    { ruleKey: "high_line_quantity" },
  ];
  for (const mutation of invalid) {
    assert.throws(() => validateHighOrderValueSettings(shopId, { ...settings(), ...mutation }), RuleConfigurationError);
  }
  const validVersion = { ...settings(), settingsVersion: "v1:shop_a.2-3" };
  assert.deepEqual(validateHighOrderValueSettings(shopId, validVersion), validVersion);
});

test("valid Shopify configuration currency is separate from normalized amount availability", () => {
  const candidate = { ...settings(), currencyCode: "USDC" };
  assert.deepEqual(validateHighOrderValueSettings(shopId, candidate), candidate);
  const input = base();
  input.settings = candidate;
  input.order.total = { available: false, reason: "INVALID_CURRENCY" };
  outcome(input, "unknown", "AMOUNT_UNAVAILABLE");
  amount(input, "101.00", "USDC");
  outcome(input, "unknown", "CURRENCY_UNSUPPORTED");
});

test("foreign settings or order are rejected before producing any rule evidence", () => {
  assert.throws(() => validateHighOrderValueSettings(shopId, { ...settings(), shopId: "synthetic-shop-b" }), RuleAuthorizationError);
  for (const target of ["settings", "order"] as const) {
    const input = base();
    input[target]!.shopId = "synthetic-shop-b";
    assert.throws(() => evaluateHighOrderValue(input), RuleAuthorizationError);
  }
  const disabledForeign = base();
  disabledForeign.settings = { ...disabledForeign.settings, enabled: false, shopId: "synthetic-shop-b" };
  assert.throws(() => evaluateHighOrderValue(disabledForeign), RuleAuthorizationError);
});

test("arbitrary-precision comparisons retain significant tiny digits and equal trailing zeroes", () => {
  const input = base();
  input.settings!.threshold = "90071992547409931234567890.00000000000000000001";
  amount(input, "90071992547409931234567890.00000000000000000002");
  outcome(input, "matched", "ABOVE_THRESHOLD");
  amount(input, "90071992547409931234567890.0000000000000000000100");
  outcome(input, "not_matched", "AT_OR_BELOW_THRESHOLD");
  amount(input, "90071992547409931234567890.000000000000000000009");
  outcome(input, "not_matched", "AT_OR_BELOW_THRESHOLD");
});

test("unavailable or malformed money never becomes zero, empty or safe", () => {
  for (const value of [undefined, { available: false, reason: "ACCESS_DENIED" }, { available: true, value: {} }]) {
    const input = base();
    input.order.total = value;
    outcome(input, "unknown", "AMOUNT_UNAVAILABLE");
  }
  for (const value of ["01", "+1", "1.", " 1", "NaN", -1, 100.01]) {
    const input = base();
    amount(input, value);
    outcome(input, "unknown", "INVALID_DATA");
  }
  const input = base();
  amount(input, "101", "XXX");
  outcome(input, "unknown", "CURRENCY_UNSUPPORTED");
});

test("known lifecycle exclusions precede unavailable fields and invalid numeric settings", () => {
  const cancelled = base();
  cancelled.order.cancelledAt = { available: true, value: "2026-01-02T13:00:00Z" };
  cancelled.order.createdAt = null;
  cancelled.order.total = { available: false, reason: "ACCESS_DENIED" };
  cancelled.settings!.threshold = "not-a-number";
  outcome(cancelled, "not_applicable", "ORDER_CANCELLED");
  const expired = base();
  expired.context.evaluatedAt = "2026-02-01T00:00:00Z";
  expired.order.cancelledAt = { available: false, reason: "ACCESS_DENIED" };
  outcome(expired, "not_applicable", "OUTSIDE_MONITORING_WINDOW");
  const disabled = base();
  disabled.settings!.enabled = false;
  disabled.settings!.threshold = "not-a-number";
  outcome(disabled, "not_applicable", "RULE_DISABLED");
});

test("30-day expiry is exclusive while one millisecond before expiry is eligible", () => {
  const input = base();
  input.context.evaluatedAt = "2026-01-31T23:59:59.999Z";
  outcome(input, "matched", "ABOVE_THRESHOLD");
  input.context.evaluatedAt = "2026-02-01T00:00:00.000Z";
  outcome(input, "not_applicable", "OUTSIDE_MONITORING_WINDOW");
});

test("unavailable or future creation metadata remains unknown rather than lifecycle exclusion", () => {
  const input = base();
  input.order.createdAt = null;
  outcome(input, "unknown", "ELIGIBILITY_UNAVAILABLE");
  input.order.createdAt = "malformed";
  outcome(input, "unknown", "INVALID_DATA");
  input.order.createdAt = "2026-01-04T00:00:00Z";
  outcome(input, "unknown", "INVALID_DATA");
});

test("refunds or edits use only the selected current total; fulfillment and payment are not exclusions", () => {
  const input = base();
  input.order.financialStatus = "REFUNDED";
  input.order.fulfillmentStatus = "PARTIALLY_FULFILLED";
  input.order.totalRefundedSet = { shopMoney: { amount: "999.99", currencyCode: "CAD" } };
  input.order.originalTotalPriceSet = { shopMoney: { amount: "999.99", currencyCode: "CAD" } };
  const before = outcome(input, "matched", "ABOVE_THRESHOLD");
  input.order.sourceSnapshotVersion = "synthetic-after-return";
  amount(input, "80.00");
  const after = outcome(input, "not_matched", "AT_OR_BELOW_THRESHOLD");
  assert.notEqual(after.sourceSnapshotVersion, before.sourceSnapshotVersion);
  input.order.cancelledAt = { available: true, value: "2026-01-02T13:00:00Z" };
  outcome(input, "not_applicable", "ORDER_CANCELLED");
});

test("two shops use their own explicit settings even for identical order money", () => {
  const a = base();
  const b = base();
  b.context.shopId = "synthetic-shop-b";
  b.order.shopId = "synthetic-shop-b";
  b.settings = { ...b.settings, shopId: "synthetic-shop-b", threshold: "200.00", settingsVersion: "shop-b-2" };
  const resultA = outcome(a, "matched", "ABOVE_THRESHOLD");
  const resultB = outcome(b, "not_matched", "AT_OR_BELOW_THRESHOLD");
  assert.equal(resultA.settingsVersion, "settings-1");
  assert.equal(resultB.settingsVersion, "shop-b-2");
  assert.deepEqual(evaluateHighOrderValue(a), resultA);
});
