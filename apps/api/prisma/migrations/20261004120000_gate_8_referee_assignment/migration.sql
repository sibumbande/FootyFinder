-- Gate 8 / TKT-802 (DEC-020, D2, D16, D27, D28): one FootyFinder referee per match.
--  * Match.refereeUserId: the referee currently assigned. Only matches with a T-30 go/no-go
--    (DEC-018 Quick Matches and DEC-019 team matches) have referees; the go/no-go cancels a match
--    that has no active referee at T-30 (reason NO_REFEREE, full refunds as for any no-go).
--  * MatchRefereeAssignment: permanent history of every assign, auto-assign, removal, decline and
--    role-revocation removal (who, when, why). Rows are never edited.
--  * RefereeSettings: a single row holding the default referee (D28), set by an admin.
-- A referee may also play in a match they referee (D17 reversed), so there is no lineup check.
-- The double-booking rule (D27) is enforced by the service under a lock on the referee's User row.
-- Additive only.
BEGIN;

ALTER TABLE "Match"
  ADD COLUMN "refereeUserId" UUID,
  ADD COLUMN "refereeAssignedAt" TIMESTAMP(3),
  ADD CONSTRAINT "Match_refereeUserId_fkey" FOREIGN KEY ("refereeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Match_referee_check" CHECK (
    ("refereeUserId" IS NULL AND "refereeAssignedAt" IS NULL)
    OR ("refereeUserId" IS NOT NULL AND "refereeAssignedAt" IS NOT NULL AND "goNoGoAt" IS NOT NULL)
  );
CREATE INDEX "Match_refereeUserId_startsAt_idx" ON "Match"("refereeUserId", "startsAt");

CREATE TABLE "MatchRefereeAssignment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "action" "RefereeAssignmentAction" NOT NULL,
  "refereeUserId" UUID NOT NULL,
  "actorUserId" UUID,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchRefereeAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MatchRefereeAssignment_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MatchRefereeAssignment_refereeUserId_fkey" FOREIGN KEY ("refereeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MatchRefereeAssignment_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MatchRefereeAssignment_reason_check" CHECK ("reason" IS NULL OR char_length("reason") BETWEEN 1 AND 500)
);
CREATE INDEX "MatchRefereeAssignment_matchId_createdAt_idx" ON "MatchRefereeAssignment"("matchId", "createdAt");
CREATE INDEX "MatchRefereeAssignment_refereeUserId_createdAt_idx" ON "MatchRefereeAssignment"("refereeUserId", "createdAt");
CREATE FUNCTION prevent_referee_assignment_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'referee assignment history is permanent';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "MatchRefereeAssignment_immutable"
  BEFORE UPDATE ON "MatchRefereeAssignment"
  FOR EACH ROW EXECUTE FUNCTION prevent_referee_assignment_update();

CREATE TABLE "RefereeSettings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "defaultRefereeUserId" UUID,
  "updatedById" UUID,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefereeSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RefereeSettings_singleton_check" CHECK ("id" = 1),
  CONSTRAINT "RefereeSettings_defaultRefereeUserId_fkey" FOREIGN KEY ("defaultRefereeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RefereeSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "RefereeSettings" ("id") VALUES (1);

ALTER TABLE "Match" DROP CONSTRAINT "Match_cancellationReason_check";
ALTER TABLE "Match" ADD CONSTRAINT "Match_cancellationReason_check" CHECK (
  "cancellationReason" IS NULL
  OR "cancellationReason" IN ('ORGANISER_CANCELLED', 'POSITIONS_UNFILLED', 'TEAM_FEES_UNFUNDED', 'NO_OPPONENT', 'TEAM_CANCELLED', 'NO_REFEREE')
);

COMMIT;
