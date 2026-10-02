-- CEO batch 5, item 4: the Terms retention table (clause 8) made real. One setting per category (REPORT = dry run,
-- the default; APPLY = purge), changed only by an admin with fresh MFA (audited), and one row per category per run
-- with what was found and what was purged. Financial records stay REPORT-only (CEO D12); the CHECK enforces it.
-- Additive only.
BEGIN;

CREATE TYPE "RetentionMode" AS ENUM ('REPORT', 'APPLY');

CREATE TABLE "RetentionPolicySetting" (
  "category" TEXT NOT NULL,
  "mode" "RetentionMode" NOT NULL DEFAULT 'REPORT',
  "updatedById" UUID,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RetentionPolicySetting_pkey" PRIMARY KEY ("category"),
  CONSTRAINT "RetentionPolicySetting_financial_report_only" CHECK ("category" <> 'FINANCIAL' OR "mode" = 'REPORT')
);

CREATE TABLE "RetentionRun" (
  "id" UUID NOT NULL,
  "category" TEXT NOT NULL,
  "mode" "RetentionMode" NOT NULL,
  "trigger" TEXT NOT NULL,
  "cutoffs" JSONB NOT NULL,
  "counts" JSONB NOT NULL,
  "candidateCount" INTEGER NOT NULL,
  "purgedCount" INTEGER NOT NULL DEFAULT 0,
  "actorUserId" UUID,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "RetentionRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RetentionRun_counts_non_negative" CHECK ("candidateCount" >= 0 AND "purgedCount" >= 0),
  CONSTRAINT "RetentionRun_report_purges_nothing" CHECK ("mode" = 'APPLY' OR "purgedCount" = 0)
);

CREATE INDEX "RetentionRun_category_startedAt_idx" ON "RetentionRun"("category", "startedAt");

ALTER TABLE "RetentionPolicySetting" ADD CONSTRAINT "RetentionPolicySetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RetentionRun" ADD CONSTRAINT "RetentionRun_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
