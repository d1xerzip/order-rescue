import { createHash } from "node:crypto";
import { evaluateHighOrderValue } from "./rules/high-order-value";
import { evaluateHighLineQuantity } from "./rules/high-line-quantity";
import type { HighLineQuantitySettings, HighOrderValueSettings, RuleOrderInput } from "./rules/contracts";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// Server-only adapter: no Shopify fetch, database access, threshold default or log.
// The caller supplies the winning stored snapshot and its verified locked tenant.
export function evaluateStoredOrderRules(
  snapshot: Record<string, unknown>,
  context: { shopId: string; generation: number; active: boolean; monitoringStartedAt: string; evaluatedAt: string },
  settings: HighOrderValueSettings | null,
  quantitySettings: HighLineQuantitySettings | null = null,
) {
  const sourceSnapshotVersion = `sha256:${createHash("sha256").update(canonical(snapshot)).digest("hex")}`;
  const order = {
    ...snapshot,
    shopId: context.shopId,
    generation: context.generation,
    sourceSnapshotVersion,
  } as RuleOrderInput;
  return {
    high_order_value: evaluateHighOrderValue({ context, settings, order }),
    high_line_quantity: evaluateHighLineQuantity({ context, settings: quantitySettings, order }),
  };
}

/** Compatibility adapter; both results use the same canonical snapshot path. */
export function evaluateStoredOrderValue(
  snapshot: Record<string, unknown>,
  context: Parameters<typeof evaluateStoredOrderRules>[1],
  settings: HighOrderValueSettings | null,
) {
  return evaluateStoredOrderRules(snapshot, context, settings).high_order_value;
}
