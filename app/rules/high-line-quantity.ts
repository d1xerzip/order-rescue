import {
  RuleAuthorizationError, RuleConfigurationError,
  type HighLineQuantityInput, type HighLineQuantitySettings, type RuleResult,
} from "./contracts";
import { commonConfigurationField, object, prepareRule } from "./common";

function configurationField(settings: Record<string, unknown>): string | null {
  const commonField = commonConfigurationField(settings, "high_line_quantity");
  if (commonField) return commonField;
  if (!Number.isSafeInteger(settings.threshold) || (settings.threshold as number) <= 0) return "threshold";
  return null;
}

/** Configuration write boundary. No default merchant threshold is supplied. */
export function validateHighLineQuantitySettings(
  verifiedShopId: string, input: unknown,
): Readonly<HighLineQuantitySettings> {
  const settings = object(input);
  if (!verifiedShopId || settings.shopId !== verifiedShopId) throw new RuleAuthorizationError();
  const field = configurationField(settings);
  if (field) throw new RuleConfigurationError(field);
  return Object.freeze({
    shopId: verifiedShopId, ruleKey: "high_line_quantity",
    settingsVersion: settings.settingsVersion as string,
    enabled: settings.enabled as boolean, threshold: settings.threshold as number,
  });
}

/** Pure per-line evaluation of the complete currentQuantity snapshot; never sums lines. */
export function evaluateHighLineQuantity(input: HighLineQuantityInput): RuleResult {
  const { settings, result, unavailable, applicability } = prepareRule(input, "high_line_quantity");
  if (applicability) return applicability;
  const field = configurationField(settings);
  if (field) return result("unknown", "INVALID_CONFIGURATION", { kind: "configuration", field });
  const lines = object(input.order.lines);
  if (lines.available !== true || lines.value == null) return unavailable("LINES_UNAVAILABLE", "lines");
  if (!Array.isArray(lines.value)) return unavailable("INVALID_DATA", "lines");

  const threshold = settings.threshold as number;
  const ids = new Set<string>();
  const matchingLines: Array<{ id: string; currentQuantity: number }> = [];
  let maxQuantity = 0;
  for (const value of lines.value) {
    const line = object(value);
    if (typeof line.id !== "string" || line.id !== line.id.trim() ||
      !/^gid:\/\/shopify\/LineItem\/[1-9]\d*$/.test(line.id) || ids.has(line.id)) {
      return unavailable("INVALID_DATA", "lines.id");
    }
    ids.add(line.id);
    if (line.currentQuantity == null) return unavailable("LINES_UNAVAILABLE", "lines.currentQuantity");
    if (!Number.isSafeInteger(line.currentQuantity) || (line.currentQuantity as number) < 0) {
      return unavailable("INVALID_DATA", "lines.currentQuantity");
    }
    const currentQuantity = line.currentQuantity as number;
    maxQuantity = Math.max(maxQuantity, currentQuantity);
    if (currentQuantity > threshold) matchingLines.push({ id: line.id, currentQuantity });
  }
  // Complete validation precedes matching; a valid early match cannot mask a missing/invalid later line.
  if (matchingLines.length) {
    matchingLines.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return result("matched", "ABOVE_THRESHOLD", { kind: "lines", threshold, matchingLines });
  }
  if (!lines.value.length) return result("not_matched", "EMPTY_LINES", { kind: "lines", threshold, lineCount: 0 });
  return result("not_matched", "AT_OR_BELOW_THRESHOLD", { kind: "lines", threshold, maxQuantity });
}
