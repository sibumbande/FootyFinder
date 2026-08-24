CREATE TYPE "WalletHoldStatus" AS ENUM ('ACTIVE', 'CAPTURED', 'RELEASED', 'EXPIRED');
CREATE TYPE "DurableJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

ALTER TABLE "WalletAccount" ADD CONSTRAINT "WalletAccount_nonnegative_balance" CHECK ("balanceCents" >= 0);
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_sign_matches_type" CHECK (
  ("type" IN ('DEPOSIT', 'DEPOSIT_CREDIT', 'MATCH_CANCELLATION_CREDIT', 'PLAYER_CANCELLATION_FULL_CREDIT', 'PLAYER_CANCELLATION_PARTIAL_CREDIT', 'REPLACEMENT_CREDIT') AND "amountCents" >= 0)
  OR
  ("type" IN ('MATCH_CREATE', 'MATCH_JOIN', 'MATCH_ENTRY_DEBIT') AND "amountCents" <= 0)
);

CREATE OR REPLACE FUNCTION prevent_wallet_transaction_reversal() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('SUCCEEDED', 'FAILED', 'ERROR') AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'wallet transaction terminal state is immutable';
  END IF;
  IF NEW."walletAccountId" <> OLD."walletAccountId"
     OR NEW."type" <> OLD."type"
     OR NEW."amountCents" <> OLD."amountCents"
     OR NEW."idempotencyKey" <> OLD."idempotencyKey" THEN
    RAISE EXCEPTION 'wallet transaction financial identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "WalletTransaction_immutable_transition"
  BEFORE UPDATE ON "WalletTransaction" FOR EACH ROW EXECUTE FUNCTION prevent_wallet_transaction_reversal();

CREATE TABLE "WalletHold" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "walletAccountId" UUID NOT NULL,
  "amountCents" INTEGER NOT NULL, "currency" TEXT NOT NULL DEFAULT 'ZAR',
  "status" "WalletHoldStatus" NOT NULL DEFAULT 'ACTIVE', "idempotencyKey" TEXT NOT NULL,
  "referenceType" TEXT NOT NULL, "referenceId" TEXT NOT NULL, "description" TEXT,
  "expiresAt" TIMESTAMP(3), "capturedAt" TIMESTAMP(3), "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WalletHold_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WalletHold_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "WalletAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WalletHold_positive_amount" CHECK ("amountCents" > 0),
  CONSTRAINT "WalletHold_state_timestamps" CHECK (
    ("status" = 'ACTIVE' AND "capturedAt" IS NULL AND "releasedAt" IS NULL)
    OR ("status" = 'CAPTURED' AND "capturedAt" IS NOT NULL AND "releasedAt" IS NULL)
    OR ("status" IN ('RELEASED', 'EXPIRED') AND "capturedAt" IS NULL AND "releasedAt" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "WalletHold_idempotencyKey_key" ON "WalletHold"("idempotencyKey");
CREATE INDEX "WalletHold_walletAccountId_status_expiresAt_idx" ON "WalletHold"("walletAccountId", "status", "expiresAt");
CREATE INDEX "WalletHold_referenceType_referenceId_status_idx" ON "WalletHold"("referenceType", "referenceId", "status");

CREATE TABLE "DurableJob" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "type" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL, "status" "DurableJobStatus" NOT NULL DEFAULT 'PENDING',
  "runAt" TIMESTAMP(3) NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 10, "lockedAt" TIMESTAMP(3), "lastError" TEXT,
  "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "DurableJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DurableJob_attempts_check" CHECK ("attempts" >= 0 AND "maxAttempts" > 0 AND "attempts" <= "maxAttempts")
);
CREATE UNIQUE INDEX "DurableJob_dedupeKey_key" ON "DurableJob"("dedupeKey");
CREATE INDEX "DurableJob_status_runAt_idx" ON "DurableJob"("status", "runAt");
CREATE INDEX "DurableJob_type_status_runAt_idx" ON "DurableJob"("type", "status", "runAt");
