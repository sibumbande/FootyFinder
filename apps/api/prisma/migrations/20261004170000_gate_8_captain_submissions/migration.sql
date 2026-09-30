-- Gate 8 / TKT-806 (DEC-020, D6, D10, D11).
--  * CaptainResultSubmission: a team owner/captain's (or a Quick Match host's) own version of the
--    result, sent as evidence for admins only. It never changes the referee's final result.
--    Permanent: a new submission adds a row and the latest one is used.
--  * ResultProblemReport: "Report a problem" with a final result, within 24 hours, for the admin
--    queue. Captains cannot dispute the result itself (D5, D6). One open report per person and
--    match; an admin resolves it with a note.
-- Additive only.
BEGIN;

CREATE TABLE "CaptainResultSubmission" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "side" "TeamSide",
  "submittedById" UUID NOT NULL,
  "outcomeType" "ResultOutcomeType" NOT NULL,
  "homeScore" INTEGER NOT NULL,
  "awayScore" INTEGER NOT NULL,
  "forfeitWinner" "TeamSide",
  "goals" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaptainResultSubmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CaptainResultSubmission_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CaptainResultSubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaptainResultSubmission_scores_check" CHECK ("homeScore" BETWEEN 0 AND 99 AND "awayScore" BETWEEN 0 AND 99)
);
CREATE INDEX "CaptainResultSubmission_matchId_createdAt_idx" ON "CaptainResultSubmission"("matchId", "createdAt");
CREATE INDEX "CaptainResultSubmission_submittedById_idx" ON "CaptainResultSubmission"("submittedById");
CREATE FUNCTION prevent_captain_submission_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'captain result submissions are permanent';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CaptainResultSubmission_immutable"
  BEFORE UPDATE ON "CaptainResultSubmission"
  FOR EACH ROW EXECUTE FUNCTION prevent_captain_submission_update();

CREATE TABLE "ResultProblemReport" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "reporterUserId" UUID NOT NULL,
  "side" "TeamSide",
  "message" TEXT NOT NULL,
  "status" "ResultProblemStatus" NOT NULL DEFAULT 'OPEN',
  "resolutionNote" TEXT,
  "resolvedById" UUID,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResultProblemReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResultProblemReport_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ResultProblemReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResultProblemReport_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResultProblemReport_message_check" CHECK (char_length("message") BETWEEN 10 AND 2000),
  CONSTRAINT "ResultProblemReport_resolution_check" CHECK (
    ("status" = 'OPEN' AND "resolvedAt" IS NULL AND "resolvedById" IS NULL AND "resolutionNote" IS NULL)
    OR ("status" = 'RESOLVED' AND "resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL AND char_length("resolutionNote") BETWEEN 3 AND 2000)
  )
);
CREATE UNIQUE INDEX "ResultProblemReport_one_open_per_reporter" ON "ResultProblemReport"("matchId", "reporterUserId") WHERE "status" = 'OPEN';
CREATE INDEX "ResultProblemReport_status_createdAt_idx" ON "ResultProblemReport"("status", "createdAt");

COMMIT;
