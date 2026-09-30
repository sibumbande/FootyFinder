-- Gate 9 / TKT-909 (CEO team recruitment board): the Teams tab in Social.
-- * Teams recruiting: a Team's Owner or a Captain posts for any number of positions and players,
--   with no limit on posts: positions, players wanted, format, level, usual days/times, area and a
--   note of up to 300 characters. Posts expire after 30 days and can be renewed, edited or closed.
-- * Players looking: a "Looking for a team" card on the player's own profile (off by default) with
--   positions, area, availability and a short note; listed only while it is on.
-- * Ask to join: one pending request per player per team, at most 10 pending per player, expiring
--   after 14 days; the Owner and Captains accept (normal team membership path) or decline.
-- * Posts and cards can be reported and removed by an admin. Blocking hides them both ways.
-- No money is involved. Additive only.
BEGIN;

CREATE TABLE "TeamRecruitmentPost" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "teamId" UUID NOT NULL,
  "createdById" UUID NOT NULL,
  "positions" "FootballPosition"[] NOT NULL,
  "playersWanted" INTEGER NOT NULL,
  "format" "MatchFormat" NOT NULL,
  "level" "RecruitmentLevel" NOT NULL,
  "days" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "times" "TimeOfDay"[] NOT NULL DEFAULT ARRAY[]::"TimeOfDay"[],
  "area" TEXT NOT NULL,
  "note" TEXT,
  "status" "RecruitmentPostStatus" NOT NULL DEFAULT 'OPEN',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "removedAt" TIMESTAMP(3),
  "removedById" UUID,
  "removedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamRecruitmentPost_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamRecruitmentPost_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeamRecruitmentPost_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeamRecruitmentPost_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TeamRecruitmentPost_players_check" CHECK ("playersWanted" BETWEEN 1 AND 99),
  CONSTRAINT "TeamRecruitmentPost_positions_check" CHECK (cardinality("positions") BETWEEN 1 AND 4),
  CONSTRAINT "TeamRecruitmentPost_days_check" CHECK ("days" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]),
  CONSTRAINT "TeamRecruitmentPost_area_check" CHECK (char_length("area") BETWEEN 2 AND 80),
  CONSTRAINT "TeamRecruitmentPost_note_check" CHECK ("note" IS NULL OR char_length("note") <= 300),
  CONSTRAINT "TeamRecruitmentPost_removed_check" CHECK (("status" = 'REMOVED') = ("removedAt" IS NOT NULL))
);
CREATE INDEX "TeamRecruitmentPost_status_expiresAt_idx" ON "TeamRecruitmentPost"("status", "expiresAt");
CREATE INDEX "TeamRecruitmentPost_teamId_status_idx" ON "TeamRecruitmentPost"("teamId", "status");

CREATE TABLE "PlayerLookingCard" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "positions" "FootballPosition"[] NOT NULL DEFAULT ARRAY[]::"FootballPosition"[],
  "area" TEXT,
  "days" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "times" "TimeOfDay"[] NOT NULL DEFAULT ARRAY[]::"TimeOfDay"[],
  "note" TEXT,
  "removedAt" TIMESTAMP(3),
  "removedById" UUID,
  "removedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerLookingCard_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlayerLookingCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlayerLookingCard_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PlayerLookingCard_positions_check" CHECK (cardinality("positions") <= 4 AND (NOT "enabled" OR cardinality("positions") >= 1)),
  CONSTRAINT "PlayerLookingCard_days_check" CHECK ("days" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]),
  CONSTRAINT "PlayerLookingCard_area_check" CHECK ("area" IS NULL OR char_length("area") BETWEEN 2 AND 80),
  CONSTRAINT "PlayerLookingCard_note_check" CHECK ("note" IS NULL OR char_length("note") <= 300)
);
CREATE UNIQUE INDEX "PlayerLookingCard_userId_key" ON "PlayerLookingCard"("userId");
CREATE INDEX "PlayerLookingCard_enabled_updatedAt_idx" ON "PlayerLookingCard"("enabled", "updatedAt");

CREATE TABLE "TeamJoinRequest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "teamId" UUID NOT NULL,
  "postId" UUID,
  "userId" UUID NOT NULL,
  "status" "TeamJoinRequestStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  "respondedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamJoinRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamJoinRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeamJoinRequest_postId_fkey" FOREIGN KEY ("postId") REFERENCES "TeamRecruitmentPost"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TeamJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeamJoinRequest_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TeamJoinRequest_responded_check" CHECK (("status" = 'PENDING') = ("respondedAt" IS NULL))
);
CREATE UNIQUE INDEX "TeamJoinRequest_one_pending_per_team" ON "TeamJoinRequest"("teamId", "userId") WHERE "status" = 'PENDING';
CREATE INDEX "TeamJoinRequest_userId_status_idx" ON "TeamJoinRequest"("userId", "status");
CREATE INDEX "TeamJoinRequest_teamId_status_idx" ON "TeamJoinRequest"("teamId", "status");
CREATE INDEX "TeamJoinRequest_postId_status_idx" ON "TeamJoinRequest"("postId", "status");

COMMIT;
