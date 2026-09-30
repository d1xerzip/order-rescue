import {
  RuleAuthorizationError, RuleConfigurationError,
  type HighOrderValueInput, type HighOrderValueSettings,
  type RuleResult,
} from "./contracts";
import { isKnownCurrency, isSupportedCurrency } from "./currencies";

import { commonConfigurationField, object, prepareRule } from "./common";

const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
function decimal(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && DECIMAL.test(value);
}

function configurationField(settings: Record<string, unknown>): string | null {
  const commonField = commonConfigurationField(settings, "high_order_value");
  if (commonField) return commonField;
  if (!decimal(settings.threshold)) return "threshold";
  if (!isKnownCurrency(settings.currencyCode)) return "currencyCode";
  return null;
}

/** Configuration write boundary. No default merchant threshold is supplied. */
export function validateHighOrderValueSettings(
  verifiedShopId: string, input: unknown,
): Readonly<HighOrderValueSettings> {
  const settings = object(input);
  if (!verifiedShopId || settings.shopId !== verifiedShopId) throw new RuleAuthorizationError();
  const field = configurationField(settings);
  if (field) throw new RuleConfigurationError(field);
  // Copy only the allowlisted configuration, never caller-supplied extra data.
  return Object.freeze({
    shopId: verifiedShopId,
    ruleKey: "high_order_value",
    settingsVersion: settings.settingsVersion as string,
    enabled: settings.enabled as boolean,
    threshold: settings.threshold as string,
    currencyCode: settings.currencyCode as string,
  });
}

/** Align decimal scales as integers; money never passes through binary floating point. */
function greaterThan(amount: string, threshold: string): boolean {
  const [amountWhole, amountFraction = ""] = amount.split(".");
  const [thresholdWhole, thresholdFraction = ""] = threshold.split(".");
  const scale = Math.max(amountFraction.length, thresholdFraction.length);
  return BigInt(amountWhole + amountFraction.padEnd(scale, "0")) >
    BigInt(thresholdWhole + thresholdFraction.padEnd(scale, "0"));
}

/** Pure P05 contract: no clock, transport, database, logging or UI dependencies. */
export function evaluateHighOrderValue(input: HighOrderValueInput): RuleResult {
  const { order } = input;
  const { settings, result, unavailable, applicability } = prepareRule(input, "high_order_value");
  if (applicability) return applicability;

  const configField = configurationField(settings);
  if (configField) return result("unknown", "INVALID_CONFIGURATION", { kind: "configuration", field: configField });
  const total = object(order.total);
  if (total.available !== true) return unavailable("AMOUNT_UNAVAILABLE", "total");
  const money = object(total.value);
  if (money.amount == null) return unavailable("AMOUNT_UNAVAILABLE", "total.amount");
  if (money.currencyCode == null || money.currencyCode === "") return unavailable("AMOUNT_UNAVAILABLE", "total.currencyCode");
  if (!decimal(money.amount)) return unavailable("INVALID_DATA", "total.amount");
  if (!isSupportedCurrency(money.currencyCode)) return unavailable("CURRENCY_UNSUPPORTED", "total.currencyCode");
  if (money.currencyCode !== settings.currencyCode) {
    return result("unknown", "CURRENCY_MISMATCH", {
      kind: "unavailable", field: "total.currencyCode",
      expectedCurrency: settings.currencyCode as string, observedCurrency: money.currencyCode,
    });
  }
  const matched = greaterThan(money.amount, settings.threshold as string);
  return result(matched ? "matched" : "not_matched", matched ? "ABOVE_THRESHOLD" : "AT_OR_BELOW_THRESHOLD", {
    kind: "value", field: "Order.currentTotalPriceSet.shopMoney",
    amount: money.amount, threshold: settings.threshold as string, currencyCode: money.currencyCode,
  });
}
