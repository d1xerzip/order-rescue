import {
  RuleAuthorizationError, RuleConfigurationError,
  type HighOrderValueInput, type HighOrderValueSettings,
  type RuleEvidence, type RuleOutcome, type RuleReasonCode, type RuleResult,
} from "./contracts";
import { isKnownCurrency, isSupportedCurrency } from "./currencies";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const VERSION = /^[A-Za-z0-9.:_-]{1,128}$/;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function decimal(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && DECIMAL.test(value);
}

function validVersion(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && VERSION.test(value);
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  if (!Number.isFinite(Date.parse(value))) return false;
  // Date.parse accepts calendar overflow such as February 30; it is not valid evidence.
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return month >= 1 && month <= 12 && day >= 1 &&
    day <= new Date(Date.UTC(year, month, 0)).getUTCDate() &&
    Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
}

function configurationField(settings: Record<string, unknown>): string | null {
  if (settings.ruleKey !== "high_order_value") return "ruleKey";
  if (typeof settings.enabled !== "boolean") return "enabled";
  if (!validVersion(settings.settingsVersion)) return "settingsVersion";
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
  const { context, order } = input;
  const settings = object(input.settings);
  if (!context.shopId || order.shopId !== context.shopId ||
    (input.settings != null && settings.shopId !== context.shopId)) throw new RuleAuthorizationError();

  const result = (outcome: RuleOutcome, reasonCode: RuleReasonCode, evidence: RuleEvidence): RuleResult => ({
    ruleKey: "high_order_value", ruleVersion: "1.0.0",
    settingsVersion: validVersion(settings.settingsVersion) ? settings.settingsVersion : null,
    outcome, reasonCode, evidence, evaluatedAt: context.evaluatedAt,
    sourceUpdatedAt: timestamp(order.updatedAt) ? order.updatedAt : null,
    sourceSnapshotVersion: order.sourceSnapshotVersion,
  });
  const unavailable = (reason: RuleReasonCode, field: string) =>
    result("unknown", reason, { kind: "unavailable", field });
  const excluded = (reason: RuleReasonCode, gate: string) =>
    result("not_applicable", reason, { kind: "applicability", gate });

  if (input.settings == null) return result("not_applicable", "NOT_CONFIGURED", { kind: "configuration", field: "settings" });
  if (settings.enabled === false) return excluded("RULE_DISABLED", "enabled");
  if (context.active === false) return excluded("INACTIVE_INSTALLATION", "installation");
  if (Number.isSafeInteger(context.generation) && Number.isSafeInteger(order.generation) &&
    order.generation !== context.generation) return excluded("INACTIVE_INSTALLATION", "generation");

  const cancellation = object(order.cancelledAt);
  if (cancellation.available === true && timestamp(cancellation.value)) return excluded("ORDER_CANCELLED", "cancellation");
  const createdValid = timestamp(order.createdAt);
  const monitoringValid = timestamp(context.monitoringStartedAt);
  const evaluatedValid = timestamp(context.evaluatedAt);
  const created = createdValid ? Date.parse(order.createdAt as string) : NaN;
  if (createdValid && monitoringValid && created < Date.parse(context.monitoringStartedAt as string)) {
    return excluded("OUTSIDE_MONITORING_WINDOW", "monitoring");
  }
  if (createdValid && evaluatedValid && Date.parse(context.evaluatedAt) >= created + RETENTION_MS) {
    return excluded("OUTSIDE_MONITORING_WINDOW", "retention");
  }
  if (typeof context.active !== "boolean") return unavailable("ELIGIBILITY_UNAVAILABLE", "active");
  if (!Number.isSafeInteger(context.generation) || !Number.isSafeInteger(order.generation)) {
    return unavailable("ELIGIBILITY_UNAVAILABLE", "generation");
  }
  if (cancellation.available !== true || cancellation.value === undefined) return unavailable("ELIGIBILITY_UNAVAILABLE", "cancelledAt");
  if (cancellation.value !== null) return unavailable("INVALID_DATA", "cancelledAt");
  if (order.createdAt == null || object(order.createdAt).available === false) return unavailable("ELIGIBILITY_UNAVAILABLE", "createdAt");
  if (!createdValid) return unavailable("INVALID_DATA", "createdAt");
  if (!monitoringValid) return unavailable(
    context.monitoringStartedAt == null || object(context.monitoringStartedAt).available === false
      ? "ELIGIBILITY_UNAVAILABLE" : "INVALID_DATA", "monitoringStartedAt",
  );
  if (!evaluatedValid) return unavailable("INVALID_DATA", "evaluatedAt");
  if (created > Date.parse(context.evaluatedAt)) return unavailable("INVALID_DATA", "createdAt");

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
