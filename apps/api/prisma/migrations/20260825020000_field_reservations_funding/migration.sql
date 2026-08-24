CREATE TYPE "FieldReservationSource" AS ENUM ('ADMIN_LOADED', 'PLAYER_BOOKING');
CREATE TYPE "FieldReservationStatus" AS ENUM ('FUNDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "FundingObligationStatus" AS ENUM ('PENDING', 'FUNDED', 'CAPTURED', 'RELEASED');
CREATE TYPE "FundingContributionStatus" AS ENUM ('HELD', 'CAPTURED', 'RELEASED');

ALTER TABLE "WalletTransaction" DROP CONSTRAINT "WalletTransaction_sign_matches_type";
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_sign_matches_type" CHECK (
  ("type" IN ('DEPOSIT', 'DEPOSIT_CREDIT', 'MATCH_CANCELLATION_CREDIT', 'PLAYER_CANCELLATION_FULL_CREDIT', 'PLAYER_CANCELLATION_PARTIAL_CREDIT', 'REPLACEMENT_CREDIT') AND "amountCents" >= 0)
  OR
  ("type" IN ('MATCH_CREATE', 'MATCH_JOIN', 'MATCH_ENTRY_DEBIT', 'FIELD_BOOKING_DEBIT') AND "amountCents" <= 0)
);

CREATE TABLE "FieldReservation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "fieldId" UUID NOT NULL,
  "fieldPriceId" UUID NOT NULL, "matchId" UUID NOT NULL,
  "source" "FieldReservationSource" NOT NULL, "status" "FieldReservationStatus" NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
  "fundingDeadline" TIMESTAMP(3), "priceCentsSnapshot" INTEGER NOT NULL,
  "currencySnapshot" TEXT NOT NULL DEFAULT 'ZAR', "venueNameSnapshot" TEXT NOT NULL,
  "fieldNameSnapshot" TEXT NOT NULL, "addressSnapshot" TEXT NOT NULL, "citySnapshot" TEXT NOT NULL,
  "desiredVisibility" "MatchVisibility" NOT NULL DEFAULT 'PUBLIC',
  "confirmedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FieldReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FieldReservation_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ManagedField"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FieldReservation_fieldPriceId_fkey" FOREIGN KEY ("fieldPriceId") REFERENCES "ManagedFieldPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FieldReservation_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FieldReservation_time_check" CHECK ("startsAt" < "endsAt"),
  CONSTRAINT "FieldReservation_price_check" CHECK ("priceCentsSnapshot" >= 0),
  CONSTRAINT "FieldReservation_state_check" CHECK (
    ("status" = 'FUNDING' AND "fundingDeadline" IS NOT NULL AND "confirmedAt" IS NULL)
    OR ("status" = 'CONFIRMED' AND "confirmedAt" IS NOT NULL)
    OR ("status" IN ('CANCELLED', 'EXPIRED') AND "cancelledAt" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "FieldReservation_matchId_key" ON "FieldReservation"("matchId");
CREATE INDEX "FieldReservation_fieldId_status_startsAt_endsAt_idx" ON "FieldReservation"("fieldId", "status", "startsAt", "endsAt");
CREATE INDEX "FieldReservation_status_fundingDeadline_idx" ON "FieldReservation"("status", "fundingDeadline");
ALTER TABLE "FieldReservation" ADD CONSTRAINT "FieldReservation_no_overlap"
  EXCLUDE USING gist ("fieldId" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE ("status" IN ('FUNDING', 'CONFIRMED'));

CREATE TABLE "FundingObligation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "reservationId" UUID NOT NULL,
  "obligationKey" TEXT NOT NULL, "requiredCents" INTEGER NOT NULL,
  "status" "FundingObligationStatus" NOT NULL DEFAULT 'PENDING', "capturedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FundingObligation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FundingObligation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "FieldReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FundingObligation_required_check" CHECK ("requiredCents" >= 0)
);
CREATE UNIQUE INDEX "FundingObligation_reservationId_obligationKey_key" ON "FundingObligation"("reservationId", "obligationKey");
CREATE INDEX "FundingObligation_reservationId_status_idx" ON "FundingObligation"("reservationId", "status");

CREATE TABLE "FundingContribution" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "obligationId" UUID NOT NULL,
  "userId" UUID NOT NULL, "walletHoldId" UUID NOT NULL, "amountCents" INTEGER NOT NULL,
  "status" "FundingContributionStatus" NOT NULL DEFAULT 'HELD', "idempotencyKey" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3), "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FundingContribution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FundingContribution_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "FundingObligation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FundingContribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FundingContribution_walletHoldId_fkey" FOREIGN KEY ("walletHoldId") REFERENCES "WalletHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FundingContribution_amount_check" CHECK ("amountCents" > 0)
);
CREATE UNIQUE INDEX "FundingContribution_walletHoldId_key" ON "FundingContribution"("walletHoldId");
CREATE UNIQUE INDEX "FundingContribution_idempotencyKey_key" ON "FundingContribution"("idempotencyKey");
CREATE INDEX "FundingContribution_obligationId_status_createdAt_idx" ON "FundingContribution"("obligationId", "status", "createdAt");
CREATE INDEX "FundingContribution_userId_createdAt_idx" ON "FundingContribution"("userId", "createdAt");
