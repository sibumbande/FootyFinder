CREATE TYPE "TeamMatchSelectionStatus" AS ENUM (
  'INVITED',
  'SELECTED_STARTER',
  'SELECTED_SUBSTITUTE',
  'OPEN_SLOT_CLAIMED',
  'DECLINED',
  'REMOVED'
);

CREATE TABLE "TeamMatchSelection" (
  "id" UUID NOT NULL,
  "matchTeamId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "status" "TeamMatchSelectionStatus" NOT NULL,
  "selectedByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamMatchSelection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamMatchLineupSlot" (
  "id" UUID NOT NULL,
  "matchTeamId" UUID NOT NULL,
  "slotIndex" INTEGER NOT NULL,
  "positionX" DECIMAL(5,2) NOT NULL,
  "positionY" DECIMAL(5,2) NOT NULL,
  "isOpen" BOOLEAN NOT NULL DEFAULT false,
  "selectionId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamMatchLineupSlot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamMatchLineupSlot_slotIndex_check" CHECK ("slotIndex" > 0),
  CONSTRAINT "TeamMatchLineupSlot_positionX_check" CHECK ("positionX" BETWEEN 0 AND 100),
  CONSTRAINT "TeamMatchLineupSlot_positionY_check" CHECK ("positionY" BETWEEN 0 AND 100),
  CONSTRAINT "TeamMatchLineupSlot_open_assignment_check" CHECK (NOT "isOpen" OR "selectionId" IS NULL)
);

CREATE UNIQUE INDEX "TeamMatchSelection_matchTeamId_userId_key"
ON "TeamMatchSelection"("matchTeamId", "userId");
CREATE INDEX "TeamMatchSelection_matchTeamId_status_idx"
ON "TeamMatchSelection"("matchTeamId", "status");
CREATE INDEX "TeamMatchSelection_userId_idx" ON "TeamMatchSelection"("userId");
CREATE INDEX "TeamMatchSelection_selectedByUserId_idx"
ON "TeamMatchSelection"("selectedByUserId");

CREATE UNIQUE INDEX "TeamMatchLineupSlot_selectionId_key"
ON "TeamMatchLineupSlot"("selectionId");
CREATE UNIQUE INDEX "TeamMatchLineupSlot_matchTeamId_slotIndex_key"
ON "TeamMatchLineupSlot"("matchTeamId", "slotIndex");
CREATE INDEX "TeamMatchLineupSlot_matchTeamId_isOpen_idx"
ON "TeamMatchLineupSlot"("matchTeamId", "isOpen");

ALTER TABLE "TeamMatchSelection"
ADD CONSTRAINT "TeamMatchSelection_matchTeamId_fkey"
FOREIGN KEY ("matchTeamId") REFERENCES "MatchTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMatchSelection"
ADD CONSTRAINT "TeamMatchSelection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamMatchSelection"
ADD CONSTRAINT "TeamMatchSelection_selectedByUserId_fkey"
FOREIGN KEY ("selectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TeamMatchLineupSlot"
ADD CONSTRAINT "TeamMatchLineupSlot_matchTeamId_fkey"
FOREIGN KEY ("matchTeamId") REFERENCES "MatchTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMatchLineupSlot"
ADD CONSTRAINT "TeamMatchLineupSlot_selectionId_fkey"
FOREIGN KEY ("selectionId") REFERENCES "TeamMatchSelection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing Team fixtures receive their already-persisted side-specific pitch
-- coordinates without inventing Match-Day selections.
INSERT INTO "TeamMatchLineupSlot" (
  "id", "matchTeamId", "slotIndex", "positionX", "positionY", "isOpen", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), mt."id", fs."slotIndex", fs."positionX", fs."positionY", false,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "MatchTeam" mt
INNER JOIN "FormationSlot" fs
  ON fs."matchId" = mt."matchId" AND fs."team" = mt."side";
