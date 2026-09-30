ALTER TABLE "PrivacyReceipt"
 ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
 ADD COLUMN "leaseToken" TEXT,
 ADD COLUMN "leaseUntil" TIMESTAMP(3),
 ADD COLUMN "completedAt" TIMESTAMP(3),
 ADD COLUMN "errorCode" TEXT,
 ADD COLUMN "encryptedExport" TEXT,
 ADD COLUMN "exportExpiresAt" TIMESTAMP(3),
 ADD COLUMN "deliveredAt" TIMESTAMP(3),
 ADD COLUMN "encryptedDelivery" TEXT;
CREATE INDEX "PrivacyReceipt_status_availableAt_leaseUntil_idx" ON "PrivacyReceipt"("status", "availableAt", "leaseUntil");
CREATE TABLE "PrivacyDeletion" (
 "shopKey" TEXT NOT NULL,
 "orderKey" TEXT NOT NULL,
 "deletedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PrivacyDeletion_pkey" PRIMARY KEY ("shopKey", "orderKey")
);
-- Inherited template staff contact fields are not needed by this app.
UPDATE "Session" SET "firstName"=NULL, "lastName"=NULL, "email"=NULL,
 "locale"=NULL, "emailVerified"=false;
