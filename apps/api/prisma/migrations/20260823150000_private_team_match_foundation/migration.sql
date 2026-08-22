ALTER TYPE "MatchStatus" ADD VALUE IF NOT EXISTS 'DRAFT' BEFORE 'OPEN';

CREATE TYPE "MatchMode" AS ENUM ('QUICK_GAME', 'TEAM_MATCH');

ALTER TABLE "Match"
ADD COLUMN "mode" "MatchMode" NOT NULL DEFAULT 'QUICK_GAME';

CREATE TABLE "MatchTeam" (
  "id" UUID NOT NULL,
  "matchId" UUID NOT NULL,
  "teamId" UUID,
  "side" "TeamSide" NOT NULL,
  "organisingUserId" UUID NOT NULL,
  "formationKey" TEXT NOT NULL,
  "teamNameSnapshot" TEXT NOT NULL,
  "teamImageUrlSnapshot" TEXT,
  "primaryColorSnapshot" TEXT,
  "secondaryColorSnapshot" TEXT,
  "availabilityRequestedAt" TIMESTAMP(3),
  "lineupFinalizedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatchTeam_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MatchTeam_matchId_side_key" ON "MatchTeam"("matchId", "side");
CREATE UNIQUE INDEX "MatchTeam_matchId_teamId_key" ON "MatchTeam"("matchId", "teamId");
CREATE INDEX "MatchTeam_teamId_idx" ON "MatchTeam"("teamId");
CREATE INDEX "MatchTeam_organisingUserId_idx" ON "MatchTeam"("organisingUserId");

ALTER TABLE "MatchTeam"
ADD CONSTRAINT "MatchTeam_matchId_fkey"
FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MatchTeam"
ADD CONSTRAINT "MatchTeam_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MatchTeam"
ADD CONSTRAINT "MatchTeam_organisingUserId_fkey"
FOREIGN KEY ("organisingUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
