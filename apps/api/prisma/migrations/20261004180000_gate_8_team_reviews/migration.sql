-- Gate 8 / TKT-809 (DEC-017 as confirmed by DEC-020, D24): team reviews.
-- A player in a match's kickoff lineup record who played (D14) may leave one 1-5 rating, with
-- optional text, for the opposing team once the referee's (or an admin's) result is final and the
-- match was played or forfeited. The author is kept privately for moderation and never shown
-- publicly. Ratings count at once; text stays hidden until an admin approves it. Hidden, reported
-- and deleted reviews do not count. Authors can edit for 7 days from the final result and delete
-- at any time (the row is kept, marked DELETED, for the audit trail). Additive only.
BEGIN;

CREATE TYPE "TeamReviewStatus" AS ENUM ('VISIBLE', 'HIDDEN', 'DELETED');
CREATE TYPE "TeamReviewTextStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "TeamReview" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "authorUserId" UUID NOT NULL,
  "teamId" UUID NOT NULL,
  "side" "TeamSide" NOT NULL,
  "rating" INTEGER NOT NULL,
  "text" TEXT,
  "textStatus" "TeamReviewTextStatus",
  "status" "TeamReviewStatus" NOT NULL DEFAULT 'VISIBLE',
  "reportedAt" TIMESTAMP(3),
  "editableUntil" TIMESTAMP(3) NOT NULL,
  "moderatedById" UUID,
  "moderatedAt" TIMESTAMP(3),
  "moderationNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamReview_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeamReview_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamReview_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeamReview_moderatedById_fkey" FOREIGN KEY ("moderatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamReview_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "TeamReview_text_check" CHECK (
    ("text" IS NULL AND "textStatus" IS NULL)
    OR ("text" IS NOT NULL AND char_length("text") BETWEEN 1 AND 1000 AND "textStatus" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "TeamReview_matchId_authorUserId_key" ON "TeamReview"("matchId", "authorUserId");
CREATE INDEX "TeamReview_teamId_status_idx" ON "TeamReview"("teamId", "status");
CREATE INDEX "TeamReview_textStatus_idx" ON "TeamReview"("textStatus");
CREATE INDEX "TeamReview_reportedAt_idx" ON "TeamReview"("reportedAt");

COMMIT;
