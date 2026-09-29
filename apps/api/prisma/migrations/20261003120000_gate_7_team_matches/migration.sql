-- Gate 7 / TKT-704: public team matches at managed venues (DEC-019).
--  * Match.otherSideMode: how the other side can be taken, chosen by the home captain
--    ("Teams only" or "Open to both"). Set only on DEC-019 team matches, which are always public
--    and always have a T-30 go/no-go time.
--  * Match.otherSideTakenBy: NULL until the other side is taken, then TEAM or INDIVIDUALS.
--    It is only ever changed under the Match row lock (TKT-707).
--  * MatchTeam fee snapshot: each team pays placeFeeCents (R80, set by FootyFinder) for every
--    starting position of the format plus every sub that team chose. Legacy sides keep NULLs.
--  * Match_cancellationReason_check gains the team-match reasons.
-- Additive only. No index uses a function.
BEGIN;

CREATE TYPE "TeamMatchOtherSideMode" AS ENUM ('TEAMS_ONLY', 'OPEN');
CREATE TYPE "TeamMatchOtherSideTakenBy" AS ENUM ('TEAM', 'INDIVIDUALS');

ALTER TABLE "Match"
  ADD COLUMN "otherSideMode" "TeamMatchOtherSideMode",
  ADD COLUMN "otherSideTakenBy" "TeamMatchOtherSideTakenBy";

ALTER TABLE "Match" ADD CONSTRAINT "Match_other_side_check" CHECK (
  ("otherSideMode" IS NULL AND "otherSideTakenBy" IS NULL)
  OR ("otherSideMode" IS NOT NULL AND "mode" = 'TEAM_MATCH' AND "visibility" = 'PUBLIC' AND "goNoGoAt" IS NOT NULL)
);
ALTER TABLE "Match" ADD CONSTRAINT "Match_teams_only_side_check"
  CHECK (NOT ("otherSideMode" = 'TEAMS_ONLY' AND "otherSideTakenBy" = 'INDIVIDUALS'));

ALTER TABLE "Match" DROP CONSTRAINT "Match_cancellationReason_check";
ALTER TABLE "Match" ADD CONSTRAINT "Match_cancellationReason_check" CHECK (
  "cancellationReason" IS NULL
  OR "cancellationReason" IN ('ORGANISER_CANCELLED', 'POSITIONS_UNFILLED', 'TEAM_FEES_UNFUNDED', 'NO_OPPONENT', 'TEAM_CANCELLED')
);

ALTER TABLE "MatchTeam"
  ADD COLUMN "starterCount" INTEGER,
  ADD COLUMN "substituteCount" INTEGER,
  ADD COLUMN "placeFeeCents" INTEGER,
  ADD COLUMN "teamFeeCents" INTEGER;

ALTER TABLE "MatchTeam" ADD CONSTRAINT "MatchTeam_team_fee_check" CHECK (
  ("starterCount" IS NULL AND "substituteCount" IS NULL AND "placeFeeCents" IS NULL AND "teamFeeCents" IS NULL)
  OR (
    "starterCount" IN (5, 7, 11)
    AND "substituteCount" BETWEEN 0 AND 10
    AND "placeFeeCents" > 0
    AND "teamFeeCents" = "placeFeeCents" * ("starterCount" + "substituteCount")
  )
);

COMMIT;
