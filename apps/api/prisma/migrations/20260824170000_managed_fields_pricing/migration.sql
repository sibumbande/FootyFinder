CREATE TYPE "ManagedFieldStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');

CREATE TABLE "ManagedVenue" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "name" TEXT NOT NULL,
  "addressLine1" TEXT NOT NULL, "addressLine2" TEXT, "city" TEXT NOT NULL,
  "region" TEXT NOT NULL, "postalCode" TEXT, "countryCode" TEXT NOT NULL,
  "latitude" DECIMAL(9,6), "longitude" DECIMAL(9,6),
  "timezone" TEXT NOT NULL DEFAULT 'Africa/Johannesburg', "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ManagedVenue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ManagedVenue_city_isActive_idx" ON "ManagedVenue"("city", "isActive");

CREATE TABLE "ManagedField" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "venueId" UUID NOT NULL,
  "name" TEXT NOT NULL, "description" TEXT, "status" "ManagedFieldStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManagedField_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManagedField_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "ManagedVenue"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManagedField_venueId_name_key" ON "ManagedField"("venueId", "name");
CREATE INDEX "ManagedField_venueId_status_idx" ON "ManagedField"("venueId", "status");

CREATE TABLE "ManagedFieldSupportedFormat" (
  "fieldId" UUID NOT NULL, "format" "MatchFormat" NOT NULL,
  CONSTRAINT "ManagedFieldSupportedFormat_pkey" PRIMARY KEY ("fieldId", "format"),
  CONSTRAINT "ManagedFieldSupportedFormat_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ManagedField"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ManagedFieldAvailability" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "fieldId" UUID NOT NULL,
  "dayOfWeek" INTEGER NOT NULL, "startMinute" INTEGER NOT NULL, "endMinute" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagedFieldAvailability_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManagedFieldAvailability_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ManagedField"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ManagedFieldAvailability_day_check" CHECK ("dayOfWeek" BETWEEN 0 AND 6),
  CONSTRAINT "ManagedFieldAvailability_time_check" CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute")
);
CREATE INDEX "ManagedFieldAvailability_fieldId_dayOfWeek_idx" ON "ManagedFieldAvailability"("fieldId", "dayOfWeek");

CREATE TABLE "ManagedFieldException" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "fieldId" UUID NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
  "available" BOOLEAN NOT NULL DEFAULT false, "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManagedFieldException_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManagedFieldException_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ManagedField"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ManagedFieldException_time_check" CHECK ("startsAt" < "endsAt")
);
CREATE INDEX "ManagedFieldException_fieldId_startsAt_endsAt_idx" ON "ManagedFieldException"("fieldId", "startsAt", "endsAt");

CREATE TABLE "ManagedFieldPrice" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "fieldId" UUID NOT NULL,
  "amountCents" INTEGER NOT NULL, "currency" TEXT NOT NULL DEFAULT 'ZAR',
  "effectiveFrom" TIMESTAMP(3) NOT NULL, "effectiveTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagedFieldPrice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManagedFieldPrice_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ManagedField"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManagedFieldPrice_amount_check" CHECK ("amountCents" >= 0),
  CONSTRAINT "ManagedFieldPrice_time_check" CHECK ("effectiveTo" IS NULL OR "effectiveFrom" < "effectiveTo")
);
CREATE INDEX "ManagedFieldPrice_fieldId_effectiveFrom_idx" ON "ManagedFieldPrice"("fieldId", "effectiveFrom");

-- PostgreSQL enforces non-overlapping effective price history under concurrent writers.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "ManagedFieldPrice" ADD CONSTRAINT "ManagedFieldPrice_no_overlap"
  EXCLUDE USING gist (
    "fieldId" WITH =,
    tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp), '[)') WITH &&
  );
