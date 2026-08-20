CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'CAPTAIN', 'MEMBER');

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_MEMBER_JOINED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_UPDATED';

CREATE TABLE "Team" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "shortName" TEXT,
  "description" TEXT,
  "profileImageUrl" TEXT,
  "locationText" TEXT,
  "primaryFormat" "MatchFormat" NOT NULL,
  "primaryColor" TEXT,
  "secondaryColor" TEXT,
  "ownerUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamMembership" (
  "id" UUID NOT NULL,
  "teamId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamInvite" (
  "id" UUID NOT NULL,
  "teamId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "maxUses" INTEGER NOT NULL DEFAULT 1,
  "useCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamFormation" (
  "id" UUID NOT NULL,
  "teamId" UUID NOT NULL,
  "format" "MatchFormat" NOT NULL,
  "formationKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamFormation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamFormationSlot" (
  "id" UUID NOT NULL,
  "formationId" UUID NOT NULL,
  "slotIndex" INTEGER NOT NULL,
  "positionX" DECIMAL(5,2) NOT NULL,
  "positionY" DECIMAL(5,2) NOT NULL,
  "membershipId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamFormationSlot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Team_ownerUserId_idx" ON "Team"("ownerUserId");
CREATE INDEX "Team_name_idx" ON "Team"("name");
CREATE UNIQUE INDEX "TeamMembership_teamId_userId_key" ON "TeamMembership"("teamId", "userId");
CREATE INDEX "TeamMembership_userId_idx" ON "TeamMembership"("userId");
CREATE INDEX "TeamMembership_teamId_role_idx" ON "TeamMembership"("teamId", "role");
CREATE UNIQUE INDEX "TeamInvite_tokenHash_key" ON "TeamInvite"("tokenHash");
CREATE INDEX "TeamInvite_teamId_createdAt_idx" ON "TeamInvite"("teamId", "createdAt");
CREATE UNIQUE INDEX "TeamFormation_teamId_format_key" ON "TeamFormation"("teamId", "format");
CREATE UNIQUE INDEX "TeamFormationSlot_formationId_slotIndex_key" ON "TeamFormationSlot"("formationId", "slotIndex");
CREATE UNIQUE INDEX "TeamFormationSlot_formationId_membershipId_key" ON "TeamFormationSlot"("formationId", "membershipId");
CREATE INDEX "TeamFormationSlot_membershipId_idx" ON "TeamFormationSlot"("membershipId");

ALTER TABLE "Team" ADD CONSTRAINT "Team_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamFormation" ADD CONSTRAINT "TeamFormation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamFormationSlot" ADD CONSTRAINT "TeamFormationSlot_formationId_fkey" FOREIGN KEY ("formationId") REFERENCES "TeamFormation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamFormationSlot" ADD CONSTRAINT "TeamFormationSlot_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "TeamMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
