CREATE TABLE "Session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shop" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "isOnline" BOOLEAN NOT NULL DEFAULT false,
  "scope" TEXT,
  "expires" TIMESTAMP(3),
  "accessToken" TEXT NOT NULL,
  "userId" BIGINT,
  "firstName" TEXT,
  "lastName" TEXT,
  "email" TEXT,
  "accountOwner" BOOLEAN NOT NULL DEFAULT false,
  "locale" TEXT,
  "collaborator" BOOLEAN DEFAULT false,
  "emailVerified" BOOLEAN DEFAULT false,
  "refreshToken" TEXT,
  "refreshTokenExpires" TIMESTAMP(3)
);
CREATE INDEX "Session_shop_idx" ON "Session"("shop");
CREATE TABLE "Shop" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "domain" TEXT NOT NULL,
  "shopifyId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uninstalledAt" TIMESTAMP(3),
  "jobsEnabled" BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");
CREATE UNIQUE INDEX "Shop_shopifyId_key" ON "Shop"("shopifyId");
CREATE TABLE "WorkspaceRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL DEFAULT 'Order Rescue',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceRecord_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkspaceRecord_shopId_key" ON "WorkspaceRecord"("shopId");
CREATE TABLE "LifecycleDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopDomain" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "triggeredAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "LifecycleDelivery_shopDomain_deliveryId_key" ON "LifecycleDelivery"("shopDomain", "deliveryId");
CREATE TABLE "PrivacyReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopDomain" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PrivacyReceipt_shopDomain_topic_deliveryId_key" ON "PrivacyReceipt"("shopDomain", "topic", "deliveryId");
