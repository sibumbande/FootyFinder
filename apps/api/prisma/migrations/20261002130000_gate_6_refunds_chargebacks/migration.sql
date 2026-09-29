-- Gate 6 / TKT-606: external card refunds and chargebacks (DEC-011, CEO decisions D2/D3/D5/D6).
-- Additive tables and columns. Two existing CHECK constraints are replaced by wider ones:
--  * WalletTransaction_sign_matches_type gains the four new ledger types (same pattern as
--    20260825020000_field_reservations_funding).
--  * WalletAccount_nonnegative_balance becomes "non-negative unless spending is restricted":
--    only a chargeback reversal may take a wallet below zero, and it always restricts spending.
BEGIN;

CREATE TYPE "ProviderRefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'RESTORED_TO_WALLET');
CREATE TYPE "ProviderDisputeStatus" AS ENUM ('OPEN', 'WON', 'LOST');

ALTER TABLE "WalletAccount"
  ADD COLUMN "spendingRestrictedAt" TIMESTAMP(3),
  ADD COLUMN "spendingRestrictionReason" TEXT;

ALTER TABLE "WalletAccount" DROP CONSTRAINT "WalletAccount_nonnegative_balance";
ALTER TABLE "WalletAccount" ADD CONSTRAINT "WalletAccount_nonnegative_balance"
  CHECK ("balanceCents" >= 0 OR "spendingRestrictedAt" IS NOT NULL);

ALTER TABLE "WalletTransaction" DROP CONSTRAINT "WalletTransaction_sign_matches_type";
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_sign_matches_type" CHECK (
  ("type" IN ('DEPOSIT', 'DEPOSIT_CREDIT', 'MATCH_CANCELLATION_CREDIT', 'PLAYER_CANCELLATION_FULL_CREDIT', 'PLAYER_CANCELLATION_PARTIAL_CREDIT', 'REPLACEMENT_CREDIT', 'TOP_UP_REFUND_RESTORE_CREDIT', 'CHARGEBACK_REVERSAL_CREDIT') AND "amountCents" >= 0)
  OR
  ("type" IN ('MATCH_CREATE', 'MATCH_JOIN', 'MATCH_ENTRY_DEBIT', 'FIELD_BOOKING_DEBIT', 'TOP_UP_REFUND_DEBIT', 'CHARGEBACK_DEBIT') AND "amountCents" <= 0)
);

CREATE TABLE "ProviderRefund" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "providerPaymentId" UUID NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "status" "ProviderRefundStatus" NOT NULL DEFAULT 'PENDING',
  "providerRefundId" TEXT,
  "debitTransactionId" UUID NOT NULL,
  "restoreTransactionId" UUID,
  "reason" TEXT NOT NULL,
  "initiatedByUserId" UUID NOT NULL,
  "restoredByUserId" UUID,
  "restoreReason" TEXT,
  "failureReason" TEXT,
  "reviewReason" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderRefund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderRefund_providerPaymentId_fkey" FOREIGN KEY ("providerPaymentId") REFERENCES "ProviderPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProviderRefund_debitTransactionId_fkey" FOREIGN KEY ("debitTransactionId") REFERENCES "WalletTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProviderRefund_restoreTransactionId_fkey" FOREIGN KEY ("restoreTransactionId") REFERENCES "WalletTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProviderRefund_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProviderRefund_restoredByUserId_fkey" FOREIGN KEY ("restoredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProviderRefund_amount_check" CHECK ("amountCents" > 0),
  CONSTRAINT "ProviderRefund_restore_check" CHECK (
    ("status" = 'RESTORED_TO_WALLET') = ("restoreTransactionId" IS NOT NULL AND "restoredByUserId" IS NOT NULL AND "restoreReason" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "ProviderRefund_providerRefundId_key" ON "ProviderRefund"("providerRefundId");
CREATE UNIQUE INDEX "ProviderRefund_debitTransactionId_key" ON "ProviderRefund"("debitTransactionId");
CREATE UNIQUE INDEX "ProviderRefund_restoreTransactionId_key" ON "ProviderRefund"("restoreTransactionId");
CREATE INDEX "ProviderRefund_providerPaymentId_status_idx" ON "ProviderRefund"("providerPaymentId", "status");
CREATE INDEX "ProviderRefund_status_createdAt_idx" ON "ProviderRefund"("status", "createdAt");

CREATE TABLE "ProviderDispute" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "providerPaymentId" UUID NOT NULL,
  "providerDisputeId" TEXT NOT NULL,
  "status" "ProviderDisputeStatus" NOT NULL DEFAULT 'OPEN',
  "amountCents" INTEGER NOT NULL,
  "debitTransactionId" UUID NOT NULL,
  "reversalTransactionId" UUID,
  "resolution" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderDispute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderDispute_providerPaymentId_fkey" FOREIGN KEY ("providerPaymentId") REFERENCES "ProviderPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProviderDispute_debitTransactionId_fkey" FOREIGN KEY ("debitTransactionId") REFERENCES "WalletTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProviderDispute_reversalTransactionId_fkey" FOREIGN KEY ("reversalTransactionId") REFERENCES "WalletTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProviderDispute_amount_check" CHECK ("amountCents" > 0),
  CONSTRAINT "ProviderDispute_won_reversal_check" CHECK (("status" = 'WON') = ("reversalTransactionId" IS NOT NULL)),
  CONSTRAINT "ProviderDispute_resolved_check" CHECK (("status" = 'OPEN') = ("resolvedAt" IS NULL))
);
CREATE UNIQUE INDEX "ProviderDispute_providerDisputeId_key" ON "ProviderDispute"("providerDisputeId");
CREATE UNIQUE INDEX "ProviderDispute_debitTransactionId_key" ON "ProviderDispute"("debitTransactionId");
CREATE UNIQUE INDEX "ProviderDispute_reversalTransactionId_key" ON "ProviderDispute"("reversalTransactionId");
CREATE INDEX "ProviderDispute_providerPaymentId_status_idx" ON "ProviderDispute"("providerPaymentId", "status");
CREATE INDEX "ProviderDispute_status_openedAt_idx" ON "ProviderDispute"("status", "openedAt");

COMMIT;
