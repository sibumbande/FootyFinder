-- CEO touch-up batch 3, item 2: an "About this venue" bio (plain text, up to 1,000 characters) and up to five
-- links (website, Instagram, Facebook, X, TikTok or other) per venue. Edited with the photos, so on a live venue
-- they wait for a second admin like any other content change (D1). Additive only.
BEGIN;

CREATE TYPE "VenueLinkType" AS ENUM ('WEBSITE', 'INSTAGRAM', 'FACEBOOK', 'X', 'TIKTOK', 'OTHER');

ALTER TABLE "ManagedVenue"
  ADD COLUMN "aboutText" TEXT,
  ADD CONSTRAINT "ManagedVenue_aboutText_length_check" CHECK ("aboutText" IS NULL OR char_length("aboutText") <= 1000);

CREATE TABLE "ManagedVenueLink" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "venueId" UUID NOT NULL,
  "type" "VenueLinkType" NOT NULL,
  "label" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagedVenueLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManagedVenueLink_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "ManagedVenue"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ManagedVenueLink_sortOrder_check" CHECK ("sortOrder" BETWEEN 0 AND 4),
  CONSTRAINT "ManagedVenueLink_url_check" CHECK ("url" LIKE 'https://%'),
  CONSTRAINT "ManagedVenueLink_label_check" CHECK (char_length("label") BETWEEN 1 AND 40)
);
CREATE UNIQUE INDEX "ManagedVenueLink_venueId_sortOrder_key" ON "ManagedVenueLink"("venueId", "sortOrder");

COMMIT;
