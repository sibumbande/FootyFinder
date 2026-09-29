-- Gate 6 / TKT-607: venue payables and encrypted beneficiaries (DEC-012 + DEC-018). Additive only.
-- A venue is owed money only for a match that went ahead: a payable is created exactly once per
-- reservation (unique reservationId) from the admin-only priceCentsSnapshot, when a confirmed
-- go/no-go Quick Match kicks off. A cancelled match never reaches that point, and the INSERT
-- trigger below refuses any payable whose reservation or match does not qualify.
BEGIN;

CREATE TYPE "VenueBeneficiaryStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'RETIRED');
CREATE TYPE "VenuePayableStatus" AS ENUM ('DUE', 'IN_BATCH', 'PAID', 'VOID');

CREATE TABLE "VenueBeneficiary" (
  "id" UUID NOT NULL,
  "venueId" UUID NOT NULL,
  "displayName" TEXT NOT NULL,
  -- AES-256-GCM ciphertext of the bank details (bound to this row id); never logged or returned
  -- by any player/host API. accountLast4 is the only plaintext fragment, for admin recognition.
  "encryptedDetails" TEXT NOT NULL,
  "keyVersion" INTEGER NOT NULL DEFAULT 1,
  "accountLast4" TEXT NOT NULL,
  "linkedUserId" UUID,
  "status" "VenueBeneficiaryStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "createdByUserId" UUID NOT NULL,
  "approvedByUserId" UUID,
  "approvedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VenueBeneficiary_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VenueBeneficiary_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "ManagedVenue"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VenueBeneficiary_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "VenueBeneficiary_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VenueBeneficiary_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VenueBeneficiary_last4_check" CHECK ("accountLast4" ~ '^[0-9]{4}$'),
  -- D8: bank details are usable only after a second, different admin approves them.
  CONSTRAINT "VenueBeneficiary_approval_check" CHECK (
    ("status" = 'PENDING_APPROVAL' AND "approvedByUserId" IS NULL)
    OR ("status" IN ('APPROVED', 'RETIRED') AND "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "approvedByUserId" <> "createdByUserId")
    OR ("status" = 'RETIRED' AND "approvedByUserId" IS NULL)
  )
);
CREATE INDEX "VenueBeneficiary_venueId_status_idx" ON "VenueBeneficiary"("venueId", "status");
-- At most one approved beneficiary per venue (plain partial index, no functions).
CREATE UNIQUE INDEX "VenueBeneficiary_one_approved_per_venue" ON "VenueBeneficiary"("venueId") WHERE "status" = 'APPROVED';

CREATE TABLE "VenuePayable" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reservationId" UUID NOT NULL,
  "matchId" UUID NOT NULL,
  "venueId" UUID NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'ZAR',
  "status" "VenuePayableStatus" NOT NULL DEFAULT 'DUE',
  "dueAt" TIMESTAMP(3) NOT NULL,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VenuePayable_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VenuePayable_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "FieldReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VenuePayable_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VenuePayable_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "ManagedVenue"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VenuePayable_amount_check" CHECK ("amountCents" >= 0),
  CONSTRAINT "VenuePayable_currency_check" CHECK ("currency" = 'ZAR'),
  CONSTRAINT "VenuePayable_paid_check" CHECK (("status" = 'PAID') = ("paidAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "VenuePayable_reservationId_key" ON "VenuePayable"("reservationId");
CREATE UNIQUE INDEX "VenuePayable_matchId_key" ON "VenuePayable"("matchId");
CREATE INDEX "VenuePayable_venueId_status_dueAt_idx" ON "VenuePayable"("venueId", "status", "dueAt");

CREATE TABLE "VenuePayableAdjustment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payableId" UUID NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "actorUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VenuePayableAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VenuePayableAdjustment_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "VenuePayable"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VenuePayableAdjustment_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VenuePayableAdjustment_amount_check" CHECK ("amountCents" <> 0)
);
CREATE INDEX "VenuePayableAdjustment_payableId_createdAt_idx" ON "VenuePayableAdjustment"("payableId", "createdAt");

-- Defence in depth for DEC-018: only a confirmed reservation of a confirmed, not-cancelled match
-- that has reached kickoff can owe the venue, and only its snapshotted price, at most once.
CREATE FUNCTION assert_venue_payable_eligible() RETURNS trigger AS $$
DECLARE
  reservation RECORD;
BEGIN
  SELECT r."status", r."priceCentsSnapshot", r."matchId", f."venueId", m."confirmedAt", m."status" AS "matchStatus"
    INTO reservation
    FROM "FieldReservation" r
    JOIN "ManagedField" f ON f."id" = r."fieldId"
    JOIN "Match" m ON m."id" = r."matchId"
    WHERE r."id" = NEW."reservationId";
  IF NOT FOUND
     OR reservation."status" <> 'CONFIRMED'
     OR reservation."confirmedAt" IS NULL
     OR reservation."matchStatus" NOT IN ('IN_PROGRESS', 'AWAITING_RESULT', 'COMPLETED')
     OR reservation."matchId" <> NEW."matchId"
     OR reservation."venueId" <> NEW."venueId"
     OR reservation."priceCentsSnapshot" <> NEW."amountCents" THEN
    RAISE EXCEPTION 'venue payable not eligible: only a confirmed match that went ahead owes its venue';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "VenuePayable_eligible"
BEFORE INSERT ON "VenuePayable"
FOR EACH ROW EXECUTE FUNCTION assert_venue_payable_eligible();

COMMIT;
