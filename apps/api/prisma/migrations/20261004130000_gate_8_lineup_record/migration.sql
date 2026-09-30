-- Gate 8 / TKT-803 (DEC-020): the lineup record taken at kickoff.
-- One row per player on either side when the match kicks off, for Quick Matches (joined
-- participants), team sides (the team's selected starters and substitutes) and the individuals'
-- side of an "Open to both" team match. The referee records scorers and assisters from this record,
-- statistics count it, and it decides who may review (DEC-017). Rows are permanent: the only
-- change allowed is the didNotPlay flag, which the referee (or an admin correction) sets with the
-- result (D14). A player appears at most once per match. Additive only.
BEGIN;

CREATE TYPE "LineupEntryRole" AS ENUM ('STARTER', 'SUBSTITUTE');
CREATE TYPE "LineupEntrySource" AS ENUM ('PARTICIPANT', 'TEAM_SELECTION');

CREATE TABLE "MatchLineupEntry" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "side" "TeamSide" NOT NULL,
  "userId" UUID NOT NULL,
  "teamId" UUID,
  "displayNameSnapshot" TEXT NOT NULL,
  "role" "LineupEntryRole" NOT NULL,
  "source" "LineupEntrySource" NOT NULL,
  "slotIndex" INTEGER,
  "didNotPlay" BOOLEAN NOT NULL DEFAULT false,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchLineupEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MatchLineupEntry_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MatchLineupEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MatchLineupEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- Only team-selection entries name a team (it may become NULL later if the team is deleted).
  CONSTRAINT "MatchLineupEntry_source_team_check" CHECK ("source" = 'TEAM_SELECTION' OR "teamId" IS NULL)
);
CREATE UNIQUE INDEX "MatchLineupEntry_matchId_userId_key" ON "MatchLineupEntry"("matchId", "userId");
CREATE INDEX "MatchLineupEntry_matchId_side_idx" ON "MatchLineupEntry"("matchId", "side");
CREATE INDEX "MatchLineupEntry_userId_idx" ON "MatchLineupEntry"("userId");

-- Permanent except didNotPlay (and teamId becoming NULL if a team is ever deleted).
CREATE FUNCTION protect_match_lineup_entry() RETURNS trigger AS $$
BEGIN
  IF NEW."matchId" IS DISTINCT FROM OLD."matchId"
     OR NEW."side" IS DISTINCT FROM OLD."side"
     OR NEW."userId" IS DISTINCT FROM OLD."userId"
     OR (NEW."teamId" IS DISTINCT FROM OLD."teamId" AND NEW."teamId" IS NOT NULL)
     OR NEW."displayNameSnapshot" IS DISTINCT FROM OLD."displayNameSnapshot"
     OR NEW."role" IS DISTINCT FROM OLD."role"
     OR NEW."source" IS DISTINCT FROM OLD."source"
     OR NEW."slotIndex" IS DISTINCT FROM OLD."slotIndex"
     OR NEW."recordedAt" IS DISTINCT FROM OLD."recordedAt" THEN
    RAISE EXCEPTION 'the kickoff lineup record is permanent';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "MatchLineupEntry_protect"
  BEFORE UPDATE ON "MatchLineupEntry"
  FOR EACH ROW EXECUTE FUNCTION protect_match_lineup_entry();

COMMIT;
