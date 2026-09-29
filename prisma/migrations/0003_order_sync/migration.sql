ALTER TABLE "OrderJob" ADD COLUMN "minimumUpdatedAt" TIMESTAMP(3);
CREATE TABLE "OrderReadLock" (
 "shopId" TEXT NOT NULL, "generation" INTEGER NOT NULL, "orderId" TEXT NOT NULL,
 "token" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "OrderReadLock_pkey" PRIMARY KEY ("shopId", "generation", "orderId"),
 CONSTRAINT "OrderReadLock_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OrderReadLock_expiresAt_idx" ON "OrderReadLock"("expiresAt");
CREATE TABLE "OrderSyncState" (
 "shopId" TEXT NOT NULL PRIMARY KEY, "generation" INTEGER NOT NULL, "phase" TEXT NOT NULL DEFAULT 'idle',
 "runId" TEXT, "windowStart" TIMESTAMP(3), "windowEnd" TIMESTAMP(3), "cursor" TEXT,
 "pageNo" INTEGER NOT NULL DEFAULT 0, "pendingCursor" TEXT, "pendingHasNextPage" BOOLEAN NOT NULL DEFAULT false,
 "pendingJobIds" JSONB NOT NULL DEFAULT '[]', "lastSuccessAt" TIMESTAMP(3), "nextRunAt" TIMESTAMP(3) NOT NULL,
 "lastError" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0, "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3),
 CONSTRAINT "OrderSyncState_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
