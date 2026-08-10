CREATE TYPE "WalletTransactionType" AS ENUM ('DEPOSIT', 'MATCH_CREATE', 'MATCH_JOIN');
CREATE TYPE "WalletTransactionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'ERROR');

ALTER TABLE "User" ADD COLUMN "balanceCents" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "WalletTransaction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "WalletTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "providerReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "matchId" UUID,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");
CREATE INDEX "WalletTransaction_userId_createdAt_idx" ON "WalletTransaction"("userId", "createdAt");
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
