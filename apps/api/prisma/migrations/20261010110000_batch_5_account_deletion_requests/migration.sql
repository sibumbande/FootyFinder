-- CEO batch 5, items 1-3 and 6: one row per deletion request. GRACE (deactivated, can still cancel by signing in),
-- WAITING (the 14 days are over but something must clear first, e.g. Team Wallet money held in a Fill Meter),
-- COMPLETED (anonymised), CANCELLED (the player signed in). BLOCKED keeps the latest attempt that was refused
-- (one row per player) so admins can see why. contactEmail is the only personal data kept after anonymisation
-- (CEO D2): finance-only, erased once every closure refund is settled and the final email has been sent.
-- Additive only.
BEGIN;

CREATE TYPE "AccountDeletionStatus" AS ENUM ('BLOCKED', 'GRACE', 'WAITING', 'COMPLETED', 'CANCELLED');

CREATE TABLE "AccountDeletionRequest" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "status" "AccountDeletionStatus" NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scheduledFor" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "blockedReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "waitingReason" TEXT,
  "lastCheckedAt" TIMESTAMP(3),
  "confirmSummary" JSONB,
  "refundSummary" JSONB,
  "uncoveredCents" INTEGER NOT NULL DEFAULT 0,
  "contactEmail" TEXT,
  "finalEmailSentAt" TIMESTAMP(3),
  "financeSettledAt" TIMESTAMP(3),
  "financeSettledById" UUID,
  "financeNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountDeletionRequest_uncovered_non_negative" CHECK ("uncoveredCents" >= 0)
);

CREATE INDEX "AccountDeletionRequest_userId_idx" ON "AccountDeletionRequest"("userId");
CREATE INDEX "AccountDeletionRequest_status_scheduledFor_idx" ON "AccountDeletionRequest"("status", "scheduledFor");
-- At most one live request (in grace or waiting) and one "latest blocked attempt" row per player.
CREATE UNIQUE INDEX "AccountDeletionRequest_one_live_per_user" ON "AccountDeletionRequest"("userId") WHERE "status" IN ('GRACE', 'WAITING');
CREATE UNIQUE INDEX "AccountDeletionRequest_one_blocked_per_user" ON "AccountDeletionRequest"("userId") WHERE "status" = 'BLOCKED';

ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_financeSettledById_fkey" FOREIGN KEY ("financeSettledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
