CREATE TYPE "ExceptionState" AS ENUM ('open', 'acknowledged', 'resolved', 'ignored');
CREATE TABLE "RuleSetting" (
  "shopId" TEXT NOT NULL, "generation" INTEGER NOT NULL, "ruleKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL, "settingsVersion" TEXT NOT NULL, "encryptedSettings" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RuleSetting_pkey" PRIMARY KEY ("shopId", "generation", "ruleKey"),
  CONSTRAINT "RuleSetting_ruleKey_check" CHECK ("ruleKey" IN ('high_order_value','high_line_quantity')),
  CONSTRAINT "RuleSetting_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "RuleSetting_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "RuleEvaluation" (
  "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "generation" INTEGER NOT NULL, "orderId" TEXT NOT NULL,
  "ruleKey" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "encryptedResult" TEXT NOT NULL, "checkedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RuleEvaluation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RuleEvaluation_ruleKey_check" CHECK ("ruleKey" IN ('high_order_value','high_line_quantity')),
  CONSTRAINT "RuleEvaluation_shopId_generation_orderId_fkey" FOREIGN KEY ("shopId","generation","orderId") REFERENCES "OrderSnapshot"("shopId","generation","orderId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RuleEvaluation_shopId_generation_orderId_ruleKey_key" ON "RuleEvaluation"("shopId","generation","orderId","ruleKey");
CREATE TABLE "ExceptionRecord" (
  "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "generation" INTEGER NOT NULL, "orderId" TEXT NOT NULL,
  "ruleKey" TEXT NOT NULL, "state" "ExceptionState" NOT NULL DEFAULT 'open', "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExceptionRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExceptionRecord_ruleKey_check" CHECK ("ruleKey" IN ('high_order_value','high_line_quantity')),
  CONSTRAINT "ExceptionRecord_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "ExceptionRecord_shopId_generation_orderId_fkey" FOREIGN KEY ("shopId","generation","orderId") REFERENCES "OrderSnapshot"("shopId","generation","orderId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ExceptionRecord_shopId_orderId_ruleKey_key" ON "ExceptionRecord"("shopId","orderId","ruleKey");
CREATE INDEX "ExceptionRecord_shopId_generation_state_idx" ON "ExceptionRecord"("shopId","generation","state");
CREATE TABLE "ExceptionHistory" (
  "id" TEXT NOT NULL, "exceptionId" TEXT NOT NULL, "revision" INTEGER NOT NULL, "kind" TEXT NOT NULL, "at" TIMESTAMP(3) NOT NULL, "encryptedDetail" TEXT NOT NULL,
  CONSTRAINT "ExceptionHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExceptionHistory_kind_check" CHECK ("kind" IN ('observation','decision')),
  CONSTRAINT "ExceptionHistory_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "ExceptionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ExceptionHistory_exceptionId_at_idx" ON "ExceptionHistory"("exceptionId","at");
CREATE UNIQUE INDEX "ExceptionHistory_exceptionId_revision_key" ON "ExceptionHistory"("exceptionId","revision");
