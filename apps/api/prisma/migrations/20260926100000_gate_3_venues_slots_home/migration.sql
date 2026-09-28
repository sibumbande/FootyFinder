BEGIN;

CREATE TYPE "VenuePublicationStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'DEACTIVATED');

ALTER TABLE "ManagedVenue"
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "publicDescription" TEXT,
  ADD COLUMN "amenities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "coverImageUrl" TEXT,
  ADD COLUMN "coverImageAlt" TEXT,
  ADD COLUMN "coverImageAttribution" TEXT,
  ADD COLUMN "publicationStatus" "VenuePublicationStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "submittedByUserId" UUID,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "approvedByUserId" UUID,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "deactivatedByUserId" UUID,
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "deactivationReason" TEXT;

UPDATE "ManagedVenue"
SET "slug" = COALESCE(NULLIF(trim(BOTH '-' FROM regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), ''), 'venue') || '-' || substring("id"::text, 1, 8);
ALTER TABLE "ManagedVenue" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "ManagedVenue_slug_key" ON "ManagedVenue"("slug");
DROP INDEX IF EXISTS "ManagedVenue_city_isActive_idx";
CREATE INDEX "ManagedVenue_city_publicationStatus_isActive_idx" ON "ManagedVenue"("city", "publicationStatus", "isActive");
ALTER TABLE "ManagedVenue" ADD CONSTRAINT "ManagedVenue_submission_approval_check" CHECK (
  ("publicationStatus" = 'DRAFT')
  OR ("publicationStatus" = 'PENDING_APPROVAL' AND "submittedByUserId" IS NOT NULL AND "submittedAt" IS NOT NULL)
  OR ("publicationStatus" = 'PUBLISHED' AND "submittedByUserId" IS NOT NULL AND "submittedAt" IS NOT NULL AND "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "submittedByUserId" <> "approvedByUserId")
  OR ("publicationStatus" = 'DEACTIVATED' AND "deactivatedByUserId" IS NOT NULL AND "deactivatedAt" IS NOT NULL AND length(trim("deactivationReason")) >= 3)
);
ALTER TABLE "ManagedVenue" ADD CONSTRAINT "ManagedVenue_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedVenue" ADD CONSTRAINT "ManagedVenue_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedVenue" ADD CONSTRAINT "ManagedVenue_deactivatedByUserId_fkey" FOREIGN KEY ("deactivatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ManagedVenueMedia" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "venueId" UUID NOT NULL,
  "url" TEXT NOT NULL,
  "altText" TEXT NOT NULL,
  "attribution" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagedVenueMedia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManagedVenueMedia_sortOrder_check" CHECK ("sortOrder" >= 0),
  CONSTRAINT "ManagedVenueMedia_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "ManagedVenue"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManagedVenueMedia_venueId_sortOrder_key" ON "ManagedVenueMedia"("venueId", "sortOrder");
CREATE INDEX "ManagedVenueMedia_venueId_idx" ON "ManagedVenueMedia"("venueId");

CREATE TABLE "ManagedVenueSlugAlias" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "venueId" UUID NOT NULL,
  "slug" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagedVenueSlugAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManagedVenueSlugAlias_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "ManagedVenue"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManagedVenueSlugAlias_slug_key" ON "ManagedVenueSlugAlias"("slug");
CREATE INDEX "ManagedVenueSlugAlias_venueId_idx" ON "ManagedVenueSlugAlias"("venueId");

CREATE TABLE "VenueCancellationPolicy" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "venueId" UUID NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "fullCreditBeforeHours" INTEGER NOT NULL DEFAULT 24,
  "lateCreditPercent" INTEGER NOT NULL DEFAULT 0,
  "venueCancellationPercent" INTEGER NOT NULL DEFAULT 100,
  "policyText" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VenueCancellationPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VenueCancellationPolicy_values_check" CHECK (
    "fullCreditBeforeHours" >= 0 AND "lateCreditPercent" BETWEEN 0 AND 100 AND "venueCancellationPercent" BETWEEN 0 AND 100
    AND ("effectiveTo" IS NULL OR "effectiveFrom" < "effectiveTo")
  ),
  CONSTRAINT "VenueCancellationPolicy_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "ManagedVenue"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "VenueCancellationPolicy_venueId_effectiveFrom_idx" ON "VenueCancellationPolicy"("venueId", "effectiveFrom");
ALTER TABLE "VenueCancellationPolicy" ADD CONSTRAINT "VenueCancellationPolicy_no_overlap"
  EXCLUDE USING gist ("venueId" WITH =, tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp), '[)') WITH &&);

ALTER TABLE "ManagedField" ADD COLUMN "turnaroundBufferMinutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "ManagedField" ADD CONSTRAINT "ManagedField_turnaroundBuffer_check" CHECK ("turnaroundBufferMinutes" >= 15 AND "turnaroundBufferMinutes" <= 240);

ALTER TABLE "ManagedFieldPrice"
  ADD COLUMN "format" "MatchFormat",
  ADD COLUMN "dayOfWeek" INTEGER,
  ADD COLUMN "startMinute" INTEGER,
  ADD COLUMN "endMinute" INTEGER;
ALTER TABLE "ManagedFieldPrice" ADD CONSTRAINT "ManagedFieldPrice_slot_scope_check" CHECK (
  ("dayOfWeek" IS NULL AND "startMinute" IS NULL AND "endMinute" IS NULL)
  OR ("dayOfWeek" BETWEEN 0 AND 6 AND "startMinute" BETWEEN 0 AND 1439 AND "endMinute" BETWEEN 1 AND 1440 AND "startMinute" < "endMinute")
);
ALTER TABLE "ManagedFieldPrice" DROP CONSTRAINT "ManagedFieldPrice_no_overlap";
ALTER TABLE "ManagedFieldPrice" ADD CONSTRAINT "ManagedFieldPrice_no_overlap"
  EXCLUDE USING gist (
    "fieldId" WITH =,
    (COALESCE("format"::text, '*')) WITH =,
    (COALESCE("dayOfWeek", -1)) WITH =,
    (COALESCE("startMinute", -1)) WITH =,
    (COALESCE("endMinute", -1)) WITH =,
    tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp), '[)') WITH &&
  );

ALTER TABLE "FieldReservation"
  ADD COLUMN "cancellationPolicyId" UUID,
  ADD COLUMN "organizerGuaranteeHoldId" UUID,
  ADD COLUMN "timezoneSnapshot" TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
  ADD COLUMN "turnaroundBufferMinutesSnapshot" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "cancellationPolicySnapshot" JSONB,
  ADD COLUMN "organizerGuaranteeCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "organizerGuaranteeSettledAt" TIMESTAMP(3),
  ADD COLUMN "playerFeesAppliedCents" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "FieldReservation_organizerGuaranteeHoldId_key" ON "FieldReservation"("organizerGuaranteeHoldId");
ALTER TABLE "FieldReservation" ADD CONSTRAINT "FieldReservation_cancellationPolicyId_fkey" FOREIGN KEY ("cancellationPolicyId") REFERENCES "VenueCancellationPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FieldReservation" ADD CONSTRAINT "FieldReservation_organizerGuaranteeHoldId_fkey" FOREIGN KEY ("organizerGuaranteeHoldId") REFERENCES "WalletHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FieldReservation" ADD CONSTRAINT "FieldReservation_gate3_values_check" CHECK (
  "turnaroundBufferMinutesSnapshot" >= 15 AND "organizerGuaranteeCents" >= 0 AND "playerFeesAppliedCents" >= 0
);

ALTER TABLE "FieldReservation" DROP CONSTRAINT "FieldReservation_no_overlap";
ALTER TABLE "FieldReservation" ADD CONSTRAINT "FieldReservation_no_overlap"
  EXCLUDE USING gist (
    "fieldId" WITH =,
    tsrange("startsAt", "endsAt" + "turnaroundBufferMinutesSnapshot" * INTERVAL '1 minute', '[)') WITH &&
  ) WHERE ("status" IN ('FUNDING', 'CONFIRMED'));

COMMIT;
