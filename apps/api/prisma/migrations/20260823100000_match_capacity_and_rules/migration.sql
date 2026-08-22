-- Persist per-match squad capacity and informational rules. Existing rows are
-- backfilled by the defaults so their current five-substitute behavior remains.
CREATE TYPE "MatchRule" AS ENUM ('GOALKEEPERS_SWAP_AFTER_EVERY_GOAL');

ALTER TABLE "Match"
ADD COLUMN "substituteCapacityPerTeam" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "rollingSubstitutes" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "rules" "MatchRule"[] NOT NULL DEFAULT ARRAY[]::"MatchRule"[];

ALTER TABLE "Match"
ADD CONSTRAINT "Match_substituteCapacityPerTeam_check"
CHECK ("substituteCapacityPerTeam" BETWEEN 0 AND 10);
