-- Gate 7 / TKT-705: the "other side" of a DEC-019 team match (replaces the DEC-015 challenge
-- model: there is no approval step, so no challenge table). The side is taken instantly by
-- whoever comes first, under the Match row lock; these triggers are the database backstop:
--  * an AWAY MatchTeam can exist on a DEC-019 team match only while otherSideTakenBy = 'TEAM';
--  * a JOINED individual on a DEC-019 team match must be on AWAY with otherSideTakenBy =
--    'INDIVIDUALS' (the home side is always the home team);
--  * TeamMatchAuditEvent is an append-only record of every team-match command and its actor.
-- Additive only. No index uses a function.
BEGIN;

CREATE FUNCTION check_team_match_away_side() RETURNS trigger AS $$
DECLARE
  taken "TeamMatchOtherSideTakenBy";
  side_mode "TeamMatchOtherSideMode";
BEGIN
  IF NEW."side" <> 'AWAY' THEN
    RETURN NEW;
  END IF;
  SELECT "otherSideMode", "otherSideTakenBy" INTO side_mode, taken FROM "Match" WHERE "id" = NEW."matchId";
  IF side_mode IS NOT NULL AND taken IS DISTINCT FROM 'TEAM' THEN
    RAISE EXCEPTION 'team match other side is not taken by a team';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "MatchTeam_away_side_check"
  BEFORE INSERT OR UPDATE OF "side", "matchId" ON "MatchTeam"
  FOR EACH ROW EXECUTE FUNCTION check_team_match_away_side();

CREATE FUNCTION check_team_match_individual() RETURNS trigger AS $$
DECLARE
  taken "TeamMatchOtherSideTakenBy";
  side_mode "TeamMatchOtherSideMode";
BEGIN
  IF NEW."status" <> 'JOINED' THEN
    RETURN NEW;
  END IF;
  SELECT "otherSideMode", "otherSideTakenBy" INTO side_mode, taken FROM "Match" WHERE "id" = NEW."matchId";
  IF side_mode IS NOT NULL AND (NEW."team" <> 'AWAY' OR taken IS DISTINCT FROM 'INDIVIDUALS') THEN
    RAISE EXCEPTION 'team match other side is not open to individual players';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "MatchParticipant_team_match_individual_check"
  BEFORE INSERT OR UPDATE OF "status", "team", "matchId" ON "MatchParticipant"
  FOR EACH ROW EXECUTE FUNCTION check_team_match_individual();

CREATE TABLE "TeamMatchAuditEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "teamId" UUID,
  "side" "TeamSide",
  "actorUserId" UUID,
  "command" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamMatchAuditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamMatchAuditEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamMatchAuditEvent_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamMatchAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "TeamMatchAuditEvent_matchId_createdAt_idx" ON "TeamMatchAuditEvent"("matchId", "createdAt");
CREATE INDEX "TeamMatchAuditEvent_teamId_createdAt_idx" ON "TeamMatchAuditEvent"("teamId", "createdAt");
CREATE FUNCTION prevent_team_match_audit_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'team match audit events are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "TeamMatchAuditEvent_immutable"
  BEFORE UPDATE ON "TeamMatchAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION prevent_team_match_audit_update();

COMMIT;
