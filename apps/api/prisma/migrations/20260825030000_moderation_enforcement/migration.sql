CREATE TYPE "ModerationReportTargetType" AS ENUM ('USER', 'DIRECT_MESSAGE', 'LOBBY_MESSAGE', 'TEAM', 'MATCH');
CREATE TYPE "ModerationReportReason" AS ENUM ('HARASSMENT', 'ABUSE', 'CHEATING', 'SPAM', 'IMPERSONATION', 'SAFETY', 'OTHER');
CREATE TYPE "ModerationReportStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');
CREATE TYPE "AccountEnforcementType" AS ENUM ('SUSPENSION', 'BAN');
CREATE TYPE "AccountEnforcementStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

CREATE TABLE "ModerationReport" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reporterUserId" UUID NOT NULL,
  "assignedAdminUserId" UUID,
  "targetType" "ModerationReportTargetType" NOT NULL,
  "targetId" UUID NOT NULL,
  "reason" "ModerationReportReason" NOT NULL,
  "details" TEXT,
  "evidenceSnapshot" JSONB NOT NULL,
  "status" "ModerationReportStatus" NOT NULL DEFAULT 'OPEN',
  "resolutionSummary" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModerationReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ModerationReport_resolution_state_check" CHECK (
    (("status" IN ('RESOLVED', 'DISMISSED')) AND "resolutionSummary" IS NOT NULL AND "resolvedAt" IS NOT NULL)
    OR (("status" IN ('OPEN', 'UNDER_REVIEW')) AND "resolutionSummary" IS NULL AND "resolvedAt" IS NULL)
  )
);

CREATE TABLE "AccountEnforcement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "type" "AccountEnforcementType" NOT NULL,
  "status" "AccountEnforcementStatus" NOT NULL DEFAULT 'ACTIVE',
  "publicReason" TEXT NOT NULL,
  "internalNote" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdByAdminUserId" UUID NOT NULL,
  "revokedByAdminUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountEnforcement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountEnforcement_type_dates_check" CHECK (
    ("type" = 'SUSPENSION' AND "endsAt" IS NOT NULL AND "endsAt" > "startsAt")
    OR ("type" = 'BAN' AND "endsAt" IS NULL)
  ),
  CONSTRAINT "AccountEnforcement_status_dates_check" CHECK (
    ("status" = 'ACTIVE' AND "revokedAt" IS NULL AND "revokedByAdminUserId" IS NULL)
    OR ("status" = 'EXPIRED' AND "revokedAt" IS NULL AND "revokedByAdminUserId" IS NULL)
    OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "revokedByAdminUserId" IS NOT NULL)
  )
);

CREATE INDEX "ModerationReport_status_createdAt_idx" ON "ModerationReport"("status", "createdAt");
CREATE INDEX "ModerationReport_targetType_targetId_createdAt_idx" ON "ModerationReport"("targetType", "targetId", "createdAt");
CREATE INDEX "ModerationReport_reporterUserId_createdAt_idx" ON "ModerationReport"("reporterUserId", "createdAt");
CREATE INDEX "ModerationReport_assignedAdminUserId_status_createdAt_idx" ON "ModerationReport"("assignedAdminUserId", "status", "createdAt");
CREATE INDEX "AccountEnforcement_userId_status_createdAt_idx" ON "AccountEnforcement"("userId", "status", "createdAt");
CREATE INDEX "AccountEnforcement_status_endsAt_idx" ON "AccountEnforcement"("status", "endsAt");
CREATE INDEX "AccountEnforcement_createdByAdminUserId_createdAt_idx" ON "AccountEnforcement"("createdByAdminUserId", "createdAt");
CREATE UNIQUE INDEX "AccountEnforcement_one_active_per_user" ON "AccountEnforcement"("userId") WHERE "status" = 'ACTIVE';

ALTER TABLE "ModerationReport" ADD CONSTRAINT "ModerationReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ModerationReport" ADD CONSTRAINT "ModerationReport_assignedAdminUserId_fkey" FOREIGN KEY ("assignedAdminUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountEnforcement" ADD CONSTRAINT "AccountEnforcement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountEnforcement" ADD CONSTRAINT "AccountEnforcement_createdByAdminUserId_fkey" FOREIGN KEY ("createdByAdminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountEnforcement" ADD CONSTRAINT "AccountEnforcement_revokedByAdminUserId_fkey" FOREIGN KEY ("revokedByAdminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
