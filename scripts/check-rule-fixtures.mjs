// Validates specification artifacts only. This is not a rule evaluator.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const doc = JSON.parse(readFileSync("docs/fixtures/rules-v1.json", "utf8"));
assert.equal(doc.synthetic, true);
assert.equal(doc.contractVersion, "1.0.0");
const ruleKeys = new Set(["high_order_value", "high_line_quantity"]);
const outcomes = new Set(["matched", "not_matched", "not_applicable", "unknown"]);
const kinds = new Set(["value", "lines", "applicability", "unavailable", "configuration"]);
const ids = new Set();
for (const example of doc.cases) {
  assert.ok(!ids.has(example.id), "DUPLICATE_FIXTURE_ID"); ids.add(example.id);
  const { input, expected } = example;
  assert.ok(ruleKeys.has(expected.ruleKey));
  assert.ok(outcomes.has(expected.outcome));
  assert.match(expected.reasonCode, /^[A-Z_]+$/);
  assert.equal(expected.ruleVersion, doc.contractVersion);
  if (expected.settingsVersion !== null) {
    assert.equal(typeof expected.settingsVersion, "string");
    assert.equal(expected.settingsVersion, input.settings?.settingsVersion);
  }
  assert.deepEqual(Object.keys(expected).sort(), ["ruleKey", "ruleVersion", "settingsVersion", "outcome", "reasonCode", "evidence", "evaluatedAt", "sourceUpdatedAt", "sourceSnapshotVersion"].sort());
  assert.equal(expected.sourceSnapshotVersion, input.order.sourceSnapshotVersion);
  assert.equal(expected.sourceUpdatedAt, input.order.updatedAt);
  assert.equal(expected.evaluatedAt, input.context.evaluatedAt);
  assert.ok(kinds.has(expected.evidence.kind));
  assert.equal(input.context.shopId, input.order.shopId);
  if (input.settings) {
    assert.equal(input.context.shopId, input.settings.shopId);
    assert.equal(input.settings.ruleKey, expected.ruleKey);
  }
  assert.equal(typeof input.order.total.available, "boolean");
  assert.equal(typeof input.order.lines.available, "boolean");
}
for (const id of ["V_BELOW", "V_EQUAL", "V_ABOVE", "V_UNAVAILABLE", "V_INVALID_CONFIG",
  "V_SHOP_B_THRESHOLD", "V_EXACT_LARGE", "V_CURRENCY_MISMATCH", "Q_BELOW", "Q_EQUAL",
  "Q_ABOVE", "Q_NO_SUM", "Q_EMPTY", "Q_INCOMPLETE_PAGES", "Q_INVALID_CONFIG", "Q_PARTIAL_FULFILLMENT"]) {
  assert.ok(ids.has(id), `MISSING_SPECIFICATION_CASE:${id}`);
}
assert.deepEqual(new Set(doc.cases.map(c => c.expected.ruleKey)), ruleKeys);
assert.deepEqual(new Set(doc.cases.map(c => c.expected.outcome)), outcomes);
assert.ok(doc.boundaryCases.length > 0);
for (const c of doc.boundaryCases) {
  assert.equal(c.expected.request, "rejected");
  assert.equal(c.expected.result, null);
  assert.equal(c.expected.evidence, null);
}
console.log(`PASS: ${doc.cases.length} synthetic specification records; ${doc.boundaryCases.length} boundary record. Evaluator NOT RUN / NOT IMPLEMENTED.`);
