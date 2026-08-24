ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_RESOLVED';

CREATE TYPE "DisputeType" AS ENUM ('MATCH_RESULT', 'FIELD_BOOKING');
CREATE TYPE "DisputeReason" AS ENUM ('INCORRECT_SCORE', 'INCORRECT_SCORERS', 'FIELD_UNAVAILABLE', 'FIELD_QUALITY', 'BOOKING_SERVICE', 'PAYMENT', 'OTHER');
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED');
CREATE TYPE "DisputeResolutionOutcome" AS ENUM ('RESULT_CONFIRMED', 'RESULT_CORRECTED', 'BOOKING_UPHELD', 'BOOKING_REJECTED');
CREATE TYPE "ResultRevisionReason" AS ENUM ('INITIAL_SUBMISSION', 'ADMIN_CORRECTION');

CREATE TABLE "Dispute" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "openedByUserId" UUID NOT NULL,
  "assignedAdminUserId" UUID,
  "type" "DisputeType" NOT NULL,
  "referenceId" UUID NOT NULL,
  "reason" "DisputeReason" NOT NULL,
  "details" TEXT NOT NULL,
  "evidenceSnapshot" JSONB NOT NULL,
  "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
  "resolutionOutcome" "DisputeResolutionOutcome",
  "resolutionSummary" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Dispute_resolution_state_check" CHECK (
    (("status" IN ('RESOLVED', 'REJECTED')) AND "resolutionOutcome" IS NOT NULL AND "resolutionSummary" IS NOT NULL AND "resolvedAt" IS NOT NULL)
    OR (("status" IN ('OPEN', 'UNDER_REVIEW')) AND "resolutionOutcome" IS NULL AND "resolutionSummary" IS NULL AND "resolvedAt" IS NULL)
  ),
  CONSTRAINT "Dispute_outcome_type_check" CHECK (
    "resolutionOutcome" IS NULL
    OR ("type" = 'MATCH_RESULT' AND "resolutionOutcome" IN ('RESULT_CONFIRMED', 'RESULT_CORRECTED'))
    OR ("type" = 'FIELD_BOOKING' AND "resolutionOutcome" IN ('BOOKING_UPHELD', 'BOOKING_REJECTED'))
  )
);

CREATE TABLE "MatchResultRevision" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchResultId" UUID NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "homeScore" INTEGER NOT NULL,
  "awayScore" INTEGER NOT NULL,
  "scorersSnapshot" JSONB NOT NULL,
  "reason" "ResultRevisionReason" NOT NULL,
  "createdByAdminUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchResultRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MatchResultRevision_values_check" CHECK ("revisionNumber" > 0 AND "homeScore" >= 0 AND "awayScore" >= 0),
  CONSTRAINT "MatchResultRevision_creator_check" CHECK (
    ("reason" = 'INITIAL_SUBMISSION' AND "createdByAdminUserId" IS NULL)
    OR ("reason" = 'ADMIN_CORRECTION' AND "createdByAdminUserId" IS NOT NULL)
  )
);

CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");
CREATE INDEX "Dispute_type_referenceId_createdAt_idx" ON "Dispute"("type", "referenceId", "createdAt");
CREATE INDEX "Dispute_openedByUserId_createdAt_idx" ON "Dispute"("openedByUserId", "createdAt");
CREATE INDEX "Dispute_assignedAdminUserId_status_createdAt_idx" ON "Dispute"("assignedAdminUserId", "status", "createdAt");
CREATE UNIQUE INDEX "Dispute_one_active_per_opener_reference" ON "Dispute"("openedByUserId", "type", "referenceId") WHERE "status" IN ('OPEN', 'UNDER_REVIEW');
CREATE UNIQUE INDEX "MatchResultRevision_matchResultId_revisionNumber_key" ON "MatchResultRevision"("matchResultId", "revisionNumber");
CREATE INDEX "MatchResultRevision_matchResultId_createdAt_idx" ON "MatchResultRevision"("matchResultId", "createdAt");
CREATE INDEX "MatchResultRevision_createdByAdminUserId_createdAt_idx" ON "MatchResultRevision"("createdByAdminUserId", "createdAt");

ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_assignedAdminUserId_fkey" FOREIGN KEY ("assignedAdminUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MatchResultRevision" ADD CONSTRAINT "MatchResultRevision_matchResultId_fkey" FOREIGN KEY ("matchResultId") REFERENCES "MatchResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchResultRevision" ADD CONSTRAINT "MatchResultRevision_createdByAdminUserId_fkey" FOREIGN KEY ("createdByAdminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "MatchResultRevision" (
  "matchResultId", "revisionNumber", "homeScore", "awayScore", "scorersSnapshot", "reason", "createdAt"
)
SELECT
  result."id",
  1,
  result."homeScore",
  result."awayScore",
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'participantId', scorer."participantId",
      'team', scorer."team",
      'goals', scorer."goals"
    ) ORDER BY scorer."id")
    FROM "MatchScorer" scorer
    WHERE scorer."matchResultId" = result."id"
  ), '[]'::jsonb),
  'INITIAL_SUBMISSION',
  result."submittedAt"
FROM "MatchResult" result;
