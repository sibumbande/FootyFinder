CREATE TYPE "TeamMatchAvailabilityStatus" AS ENUM (
  'AVAILABLE',
  'MAYBE',
  'UNAVAILABLE',
  'NO_RESPONSE'
);

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_MATCH_AVAILABILITY_REQUESTED';

CREATE TABLE "TeamMatchAvailability" (
  "id" UUID NOT NULL,
  "matchTeamId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "status" "TeamMatchAvailabilityStatus" NOT NULL DEFAULT 'NO_RESPONSE',
  "respondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamMatchAvailability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamMatchAvailability_matchTeamId_userId_key"
ON "TeamMatchAvailability"("matchTeamId", "userId");

CREATE INDEX "TeamMatchAvailability_matchTeamId_status_idx"
ON "TeamMatchAvailability"("matchTeamId", "status");

CREATE INDEX "TeamMatchAvailability_userId_idx"
ON "TeamMatchAvailability"("userId");

ALTER TABLE "TeamMatchAvailability"
ADD CONSTRAINT "TeamMatchAvailability_matchTeamId_fkey"
FOREIGN KEY ("matchTeamId") REFERENCES "MatchTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamMatchAvailability"
ADD CONSTRAINT "TeamMatchAvailability_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
