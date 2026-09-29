CREATE TYPE "OrderJobStatus" AS ENUM ('pending', 'processing', 'completed', 'retry', 'failed');
CREATE TABLE "OrderJob" (
 "id" TEXT NOT NULL PRIMARY KEY, "shopId" TEXT NOT NULL, "generation" INTEGER NOT NULL,
 "deliveryId" TEXT NOT NULL, "orderId" TEXT NOT NULL,
 "status" "OrderJobStatus" NOT NULL DEFAULT 'pending', "attempts" INTEGER NOT NULL DEFAULT 0,
 "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3), "availableAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
 "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), "expiresAt" TIMESTAMP(3) NOT NULL, "errorCode" TEXT,
 CONSTRAINT "OrderJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrderJob_shopId_generation_deliveryId_key" ON "OrderJob"("shopId", "generation", "deliveryId");
CREATE INDEX "OrderJob_status_availableAt_leaseUntil_idx" ON "OrderJob"("status", "availableAt", "leaseUntil");
CREATE INDEX "OrderJob_expiresAt_idx" ON "OrderJob"("expiresAt");
CREATE TABLE "OrderSnapshot" (
 "id" TEXT NOT NULL PRIMARY KEY, "shopId" TEXT NOT NULL, "generation" INTEGER NOT NULL, "orderId" TEXT NOT NULL,
 "encryptedSnapshot" TEXT NOT NULL, "orderCreatedAt" TIMESTAMP(3) NOT NULL, "orderUpdatedAt" TIMESTAMP(3) NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "OrderSnapshot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrderSnapshot_shopId_generation_orderId_key" ON "OrderSnapshot"("shopId", "generation", "orderId");
CREATE INDEX "OrderSnapshot_expiresAt_idx" ON "OrderSnapshot"("expiresAt");
