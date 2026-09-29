ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MATCH_CONFIRMED';

BEGIN;

-- DEC-018 T-30 go/no-go. goNoGoAt is set only on Quick Matches created under DEC-018 (legacy rows
-- stay NULL and keep the old rules). At goNoGoAt a durable job confirms the match (every formation
-- position claimed) or cancels it with cancellationReason POSITIONS_UNFILLED and refunds every fee.
ALTER TABLE "Match"
  ADD COLUMN "goNoGoAt" TIMESTAMP(3),
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "cancellationReason" TEXT;

ALTER TABLE "Match" ADD CONSTRAINT "Match_cancellationReason_check"
  CHECK ("cancellationReason" IS NULL OR "cancellationReason" IN ('ORGANISER_CANCELLED', 'POSITIONS_UNFILLED'));
ALTER TABLE "Match" ADD CONSTRAINT "Match_goNoGoAt_before_kickoff_check"
  CHECK ("goNoGoAt" IS NULL OR "goNoGoAt" < "startsAt");
ALTER TABLE "Match" ADD CONSTRAINT "Match_confirmed_or_unfilled_check"
  CHECK (NOT ("confirmedAt" IS NOT NULL AND "cancellationReason" = 'POSITIONS_UNFILLED'));

COMMIT;
