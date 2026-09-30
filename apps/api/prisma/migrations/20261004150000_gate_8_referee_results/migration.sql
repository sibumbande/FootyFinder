-- Gate 8 / TKT-804 (DEC-020): the referee's result is final (D5).
--  * MatchResult.finalSource: LEGACY for results self-reported before Gate 8 (kept as they are,
--    D20), REFEREE for the referee's submission, ADMIN when an admin entered it (D3).
--  * MatchGoal: one row per goal, credited to a side. A goal names its scorer and optional
--    assister from the kickoff lineup record; an own goal names nobody and counts for the side
--    only (D7). An assister is never the scorer.
--  * MatchResultRevision gains who created it and the outcome, so every version (referee
--    submission, admin entry, admin correction) is kept in the permanent revision history.
--  * Outcomes (D13): PLAYED, FORFEIT (winner, no goals) and ABANDONED (0-0, no goals, no stats).
-- Additive only; two CHECK constraints are recreated to allow the new values.
BEGIN;

ALTER TABLE "MatchResult"
  ADD COLUMN "finalSource" "ResultFinalSource" NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "finalizedById" UUID,
  ADD COLUMN "finalizedAt" TIMESTAMP(3),
  ADD CONSTRAINT "MatchResult_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MatchResult_final_source_check" CHECK (
    "finalSource" = 'LEGACY' OR ("finalizedById" IS NOT NULL AND "finalizedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "MatchResult_abandoned_check" CHECK (
    "outcomeType" <> 'ABANDONED' OR ("homeScore" = 0 AND "awayScore" = 0)
  );
ALTER TABLE "MatchResult" DROP CONSTRAINT "MatchResult_forfeit_consistency_check";
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_forfeit_consistency_check" CHECK (
  ("outcomeType" IN ('PLAYED', 'ABANDONED') AND "forfeitWinner" IS NULL)
  OR ("outcomeType" = 'FORFEIT' AND "forfeitWinner" IS NOT NULL)
);
CREATE INDEX "MatchResult_finalSource_finalizedAt_idx" ON "MatchResult"("finalSource", "finalizedAt");

ALTER TABLE "MatchResultRevision"
  ADD COLUMN "createdByUserId" UUID,
  ADD COLUMN "outcomeType" "ResultOutcomeType",
  ADD COLUMN "forfeitWinner" "TeamSide",
  ADD CONSTRAINT "MatchResultRevision_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchResultRevision" DROP CONSTRAINT "MatchResultRevision_creator_check";
ALTER TABLE "MatchResultRevision" ADD CONSTRAINT "MatchResultRevision_creator_check" CHECK (
  ("reason" = 'INITIAL_SUBMISSION' AND "createdByAdminUserId" IS NULL)
  OR ("reason" = 'ADMIN_CORRECTION' AND "createdByAdminUserId" IS NOT NULL)
  OR ("reason" = 'REFEREE_SUBMISSION' AND "createdByAdminUserId" IS NULL AND "createdByUserId" IS NOT NULL)
  OR ("reason" = 'ADMIN_ENTRY' AND "createdByAdminUserId" IS NOT NULL)
);

CREATE TABLE "MatchGoal" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchResultId" UUID NOT NULL,
  "side" "TeamSide" NOT NULL,
  "scorerEntryId" UUID,
  "assistEntryId" UUID,
  "ownGoal" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "MatchGoal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MatchGoal_matchResultId_fkey" FOREIGN KEY ("matchResultId") REFERENCES "MatchResult"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MatchGoal_scorerEntryId_fkey" FOREIGN KEY ("scorerEntryId") REFERENCES "MatchLineupEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MatchGoal_assistEntryId_fkey" FOREIGN KEY ("assistEntryId") REFERENCES "MatchLineupEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MatchGoal_credit_check" CHECK (
    ("ownGoal" AND "scorerEntryId" IS NULL AND "assistEntryId" IS NULL)
    OR (NOT "ownGoal" AND "scorerEntryId" IS NOT NULL)
  ),
  CONSTRAINT "MatchGoal_assist_check" CHECK ("assistEntryId" IS NULL OR "assistEntryId" <> "scorerEntryId"),
  CONSTRAINT "MatchGoal_sortOrder_check" CHECK ("sortOrder" >= 0)
);
CREATE UNIQUE INDEX "MatchGoal_matchResultId_sortOrder_key" ON "MatchGoal"("matchResultId", "sortOrder");
CREATE INDEX "MatchGoal_scorerEntryId_idx" ON "MatchGoal"("scorerEntryId");
CREATE INDEX "MatchGoal_assistEntryId_idx" ON "MatchGoal"("assistEntryId");

COMMIT;
