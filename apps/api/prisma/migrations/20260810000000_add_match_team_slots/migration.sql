CREATE TYPE "TeamSide" AS ENUM ('HOME', 'AWAY');
CREATE TYPE "SquadRole" AS ENUM ('STARTER', 'RESERVE');

ALTER TABLE "MatchParticipant"
ADD COLUMN "team" "TeamSide",
ADD COLUMN "squadRole" "SquadRole",
ADD COLUMN "slotNumber" INTEGER;

CREATE UNIQUE INDEX "MatchParticipant_matchId_team_squadRole_slotNumber_key"
ON "MatchParticipant"("matchId", "team", "squadRole", "slotNumber");
