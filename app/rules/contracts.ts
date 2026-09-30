export type RuleKey = "high_order_value" | "high_line_quantity";

export type RuleOutcome = "matched" | "not_matched" | "not_applicable" | "unknown";

export type RuleEvidence =
  | { kind: "value"; field: "Order.currentTotalPriceSet.shopMoney"; amount: string; threshold: string; currencyCode: string }
  | { kind: "lines"; threshold: number; matchingLines: { id: string; currentQuantity: number }[] }
  | { kind: "lines"; threshold: number; maxQuantity: number }
  | { kind: "lines"; threshold: number; lineCount: 0 }
  | { kind: "applicability"; gate: string }
  | { kind: "configuration"; field: string }
  | { kind: "unavailable"; field: string; expectedCurrency?: string; observedCurrency?: string };

export type RuleReasonCode =
  | "NOT_CONFIGURED" | "RULE_DISABLED" | "INACTIVE_INSTALLATION"
  | "ORDER_CANCELLED" | "OUTSIDE_MONITORING_WINDOW" | "ELIGIBILITY_UNAVAILABLE"
  | "INVALID_DATA" | "INVALID_CONFIGURATION" | "AMOUNT_UNAVAILABLE"
  | "LINES_UNAVAILABLE" | "EMPTY_LINES"
  | "CURRENCY_UNSUPPORTED" | "CURRENCY_MISMATCH" | "ABOVE_THRESHOLD" | "AT_OR_BELOW_THRESHOLD";

export type RuleResult = {
  ruleKey: RuleKey;
  ruleVersion: "1.0.0";
  settingsVersion: string | null;
  outcome: RuleOutcome;
  reasonCode: RuleReasonCode;
  evidence: RuleEvidence;
  evaluatedAt: string;
  sourceUpdatedAt: string | null;
  sourceSnapshotVersion: string;
};

/** Supplied by the verified server boundary, never selected by a merchant request. */
export type EvaluationContext = {
  shopId: string;
  generation: number;
  active: boolean;
  monitoringStartedAt: unknown;
  evaluatedAt: string;
};

/** Unknown fields permit defensive evaluation of unavailable or imported snapshots. */
export type RuleOrderInput = {
  shopId: string;
  generation: number;
  id: string;
  createdAt: unknown;
  updatedAt: unknown;
  cancelledAt: unknown;
  total: unknown;
  lines?: unknown;
  sourceSnapshotVersion: string;
};

export type HighOrderValueSettings = {
  shopId: string;
  ruleKey: "high_order_value";
  settingsVersion: string;
  enabled: boolean;
  threshold: string;
  currencyCode: string;
};

export type RuleInput = {
  context: EvaluationContext;
  order: RuleOrderInput;
  settings: unknown;
};

export class RuleAuthorizationError extends Error {
  constructor() {
    super("RULE_TENANT_MISMATCH");
    this.name = "RuleAuthorizationError";
  }
}

export class RuleConfigurationError extends Error {
  constructor(public readonly field: string) {
    super("INVALID_CONFIGURATION");
    this.name = "RuleConfigurationError";
  }
}

export type HighLineQuantitySettings = {
  shopId: string;
  ruleKey: "high_line_quantity";
  settingsVersion: string;
  enabled: boolean;
  threshold: number;
};

export type HighOrderValueInput = RuleInput;
export type HighLineQuantityInput = RuleInput;
