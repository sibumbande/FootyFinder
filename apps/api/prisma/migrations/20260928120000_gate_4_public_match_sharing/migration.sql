BEGIN;

ALTER TABLE "Match" ADD COLUMN "publicSlug" TEXT;

-- Existing public records receive opaque identifiers. Private records deliberately remain NULL.
UPDATE "Match"
SET "publicSlug" = 'm-' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 24)
WHERE "visibility" = 'PUBLIC';

CREATE UNIQUE INDEX "Match_publicSlug_key" ON "Match"("publicSlug");
ALTER TABLE "Match" ADD CONSTRAINT "Match_public_slug_visibility_check" CHECK (
  ("visibility" = 'PUBLIC' AND "publicSlug" IS NOT NULL AND "publicSlug" ~ '^m-[a-f0-9]{24}$')
  OR ("visibility" = 'PRIVATE' AND "publicSlug" IS NULL)
);

CREATE OR REPLACE FUNCTION prevent_match_public_slug_change()
RETURNS trigger AS $$
BEGIN
  IF OLD."publicSlug" IS DISTINCT FROM NEW."publicSlug" THEN
    RAISE EXCEPTION 'Match.publicSlug is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Match_public_slug_immutable"
BEFORE UPDATE OF "publicSlug" ON "Match"
FOR EACH ROW EXECUTE FUNCTION prevent_match_public_slug_change();

COMMIT;
