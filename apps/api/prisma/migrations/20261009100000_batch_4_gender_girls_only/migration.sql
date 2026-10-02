-- CEO touch-up batch 4, item 1: a player's gender (private; used only to decide who can join girls-only
-- matches) and girls-only matches. Additive: existing players have no gender yet and are asked once at their
-- next sign-in; existing matches are not girls-only.
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');
ALTER TABLE "PlayerProfile" ADD COLUMN "gender" "Gender";
ALTER TABLE "Match" ADD COLUMN "girlsOnly" BOOLEAN NOT NULL DEFAULT false;
