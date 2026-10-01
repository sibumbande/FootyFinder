-- CEO touch-up batch 3, item 1: venue photos uploaded from a computer or phone gallery instead of typed URLs.
-- * VenuePhotoFile: every processed upload (1600 px WebP plus a 400 px thumbnail, metadata stripped), staged
--   per venue until it is used by the live gallery or a pending change.
-- * ManagedVenueMedia gains the thumbnail and the storage key of uploaded photos (typed URLs keep working).
-- * VenueContentChange (D1): on a live venue, photo edits wait here for a second admin. The venue stays live
--   with its current content; approval applies the change, rejection discards it. One pending change per venue.
-- Additive only.
BEGIN;

CREATE TYPE "VenueContentChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

ALTER TABLE "ManagedVenueMedia"
  ADD COLUMN "thumbUrl" TEXT,
  ADD COLUMN "storageKey" TEXT;

CREATE TABLE "VenuePhotoFile" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "venueId" UUID NOT NULL,
  "storageKey" TEXT NOT NULL,
  "thumbKey" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "uploadedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VenuePhotoFile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VenuePhotoFile_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "ManagedVenue"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VenuePhotoFile_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VenuePhotoFile_storageKey_key" ON "VenuePhotoFile"("storageKey");
CREATE INDEX "VenuePhotoFile_venueId_idx" ON "VenuePhotoFile"("venueId");

CREATE TABLE "VenueContentChange" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "venueId" UUID NOT NULL,
  "status" "VenueContentChangeStatus" NOT NULL DEFAULT 'PENDING',
  "payload" JSONB NOT NULL,
  "submittedByUserId" UUID NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedByUserId" UUID,
  "decidedAt" TIMESTAMP(3),
  "decisionReason" TEXT,
  CONSTRAINT "VenueContentChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VenueContentChange_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "ManagedVenue"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VenueContentChange_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VenueContentChange_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "VenueContentChange_venueId_idx" ON "VenueContentChange"("venueId");
CREATE UNIQUE INDEX "VenueContentChange_one_pending_per_venue" ON "VenueContentChange"("venueId") WHERE "status" = 'PENDING';

COMMIT;
