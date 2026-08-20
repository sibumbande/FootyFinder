ALTER TYPE "MatchStatus" ADD VALUE IF NOT EXISTS 'READY';
ALTER TYPE "MatchStatus" ADD VALUE IF NOT EXISTS 'AWAITING_RESULT';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'DEPOSIT_CREDIT';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'MATCH_ENTRY_DEBIT';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'MATCH_CANCELLATION_CREDIT';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'PLAYER_CANCELLATION_FULL_CREDIT';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'PLAYER_CANCELLATION_PARTIAL_CREDIT';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'REPLACEMENT_CREDIT';

CREATE TYPE "MatchFormat" AS ENUM ('FIVE_A_SIDE', 'SEVEN_A_SIDE', 'ELEVEN_A_SIDE');
CREATE TYPE "MatchVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TYPE "FootballPosition" AS ENUM ('GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'FORWARD');
CREATE TYPE "DominantFoot" AS ENUM ('LEFT', 'RIGHT', 'BOTH');
CREATE TYPE "MatchPaymentStatus" AS ENUM ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED');
CREATE TYPE "NotificationType" AS ENUM ('INFO', 'DIRECT_MESSAGE', 'MATCH_INVITATION', 'DEPOSIT_SUCCEEDED', 'MATCH_JOINED', 'PLAYER_CANCELLED', 'REPLACEMENT_FOUND', 'WALLET_CREDIT', 'MATCH_CANCELLED', 'MATCH_STARTED', 'RESULT_SUBMITTED');

CREATE TABLE "PlayerProfile" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "displayName" TEXT NOT NULL, "avatarUrl" TEXT,
  "bio" TEXT, "dominantFoot" "DominantFoot", "homeArea" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlayerProfile_userId_key" ON "PlayerProfile"("userId");
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PlayerProfile" ("id", "userId", "displayName", "avatarUrl", "createdAt", "updatedAt")
SELECT "id", "id", COALESCE(NULLIF(TRIM(CONCAT_WS(' ', "firstName", "lastName")), ''), "username"), "avatarUrl", "createdAt", "updatedAt" FROM "User";

CREATE TABLE "PlayerPreferredPosition" (
  "profileId" UUID NOT NULL, "position" "FootballPosition" NOT NULL,
  CONSTRAINT "PlayerPreferredPosition_pkey" PRIMARY KEY ("profileId", "position")
);
ALTER TABLE "PlayerPreferredPosition" ADD CONSTRAINT "PlayerPreferredPosition_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "PlayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WalletAccount" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "currency" TEXT NOT NULL DEFAULT 'ZAR',
  "balanceCents" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "WalletAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WalletAccount_userId_key" ON "WalletAccount"("userId");
ALTER TABLE "WalletAccount" ADD CONSTRAINT "WalletAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "WalletAccount" ("id", "userId", "balanceCents", "createdAt", "updatedAt") SELECT "id", "id", "balanceCents", "createdAt", "updatedAt" FROM "User";

ALTER TABLE "WalletTransaction" ADD COLUMN "walletAccountId" UUID;
ALTER TABLE "WalletTransaction" ADD COLUMN "referenceType" TEXT;
ALTER TABLE "WalletTransaction" ADD COLUMN "referenceId" TEXT;
ALTER TABLE "WalletTransaction" ADD COLUMN "description" TEXT;
UPDATE "WalletTransaction" SET "walletAccountId" = "userId", "referenceType" = CASE WHEN "matchId" IS NULL THEN 'DEPOSIT' ELSE 'MATCH' END, "referenceId" = "matchId"::TEXT;
ALTER TABLE "WalletTransaction" ALTER COLUMN "walletAccountId" SET NOT NULL;
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "WalletAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "WalletTransaction_userId_createdAt_idx";
CREATE INDEX "WalletTransaction_walletAccountId_createdAt_idx" ON "WalletTransaction"("walletAccountId", "createdAt");
CREATE UNIQUE INDEX "WalletTransaction_provider_providerReference_key" ON "WalletTransaction"("provider", "providerReference");
ALTER TABLE "WalletTransaction" DROP CONSTRAINT "WalletTransaction_userId_fkey";
ALTER TABLE "WalletTransaction" DROP COLUMN "userId", DROP COLUMN "matchId";

CREATE TABLE "Venue" (
  "id" UUID NOT NULL, "name" TEXT NOT NULL, "addressLine1" TEXT NOT NULL, "addressLine2" TEXT,
  "locality" TEXT, "city" TEXT NOT NULL, "region" TEXT NOT NULL, "postalCode" TEXT,
  "countryCode" TEXT NOT NULL, "latitude" DECIMAL(9,6), "longitude" DECIMAL(9,6),
  "externalPlaceId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);
INSERT INTO "Venue" ("id", "name", "addressLine1", "city", "region", "countryCode", "latitude", "longitude", "createdAt", "updatedAt")
SELECT "id", "venueName", COALESCE("address", 'Address unavailable'), 'Unknown', 'Unknown', 'ZA', "latitude"::DECIMAL(9,6), "longitude"::DECIMAL(9,6), "createdAt", "updatedAt" FROM "Match";

ALTER TABLE "Match" ADD COLUMN "venueId" UUID;
ALTER TABLE "Match" ADD COLUMN "format" "MatchFormat" NOT NULL DEFAULT 'ELEVEN_A_SIDE';
ALTER TABLE "Match" ADD COLUMN "visibility" "MatchVisibility" NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "Match" ADD COLUMN "inviteToken" TEXT;
ALTER TABLE "Match" ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "Match" ADD COLUMN "feeCents" INTEGER NOT NULL DEFAULT 8000;
ALTER TABLE "Match" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'ZAR';
ALTER TABLE "Match" ADD COLUMN "cancelledAt" TIMESTAMP(3);
UPDATE "Match" SET "venueId" = "id";
ALTER TABLE "Match" ALTER COLUMN "venueId" SET NOT NULL;
ALTER TABLE "Match" ADD CONSTRAINT "Match_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Match_inviteToken_key" ON "Match"("inviteToken");
CREATE INDEX "Match_visibility_startsAt_idx" ON "Match"("visibility", "startsAt");
CREATE INDEX "Match_format_startsAt_idx" ON "Match"("format", "startsAt");
ALTER TABLE "Match" DROP COLUMN "venueName", DROP COLUMN "address", DROP COLUMN "latitude", DROP COLUMN "longitude", DROP COLUMN "maxPlayers";

UPDATE "MatchParticipant" SET "team" = 'HOME' WHERE "team" IS NULL;
ALTER TABLE "MatchParticipant" ALTER COLUMN "team" SET NOT NULL;
ALTER TABLE "MatchParticipant" ADD COLUMN "leftAt" TIMESTAMP(3);
DROP INDEX "MatchParticipant_matchId_team_squadRole_slotNumber_key";
ALTER TABLE "MatchParticipant" DROP COLUMN "role", DROP COLUMN "squadRole", DROP COLUMN "slotNumber";
CREATE INDEX "MatchParticipant_matchId_team_status_idx" ON "MatchParticipant"("matchId", "team", "status");
DROP TYPE "ParticipantRole";
DROP TYPE "SquadRole";

CREATE TABLE "FormationSlot" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "matchId" UUID NOT NULL, "team" "TeamSide" NOT NULL,
  "slotIndex" INTEGER NOT NULL, "positionX" DECIMAL(5,2) NOT NULL, "positionY" DECIMAL(5,2) NOT NULL,
  "participantId" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "FormationSlot_pkey" PRIMARY KEY ("id")
);
INSERT INTO "FormationSlot" ("matchId", "team", "slotIndex", "positionX", "positionY")
SELECT m."id", t.team::"TeamSide", p.idx, p.x, CASE WHEN t.team = 'HOME' THEN p.y ELSE 100 - p.y END
FROM "Match" m CROSS JOIN (VALUES ('HOME'), ('AWAY')) t(team)
CROSS JOIN (VALUES (1,50,92),(2,20,72),(3,40,72),(4,60,72),(5,80,72),(6,30,48),(7,50,48),(8,70,48),(9,22,22),(10,50,22),(11,78,22)) p(idx,x,y);
CREATE UNIQUE INDEX "FormationSlot_participantId_key" ON "FormationSlot"("participantId");
CREATE UNIQUE INDEX "FormationSlot_matchId_team_slotIndex_key" ON "FormationSlot"("matchId", "team", "slotIndex");
CREATE INDEX "FormationSlot_matchId_team_idx" ON "FormationSlot"("matchId", "team");
ALTER TABLE "FormationSlot" ADD CONSTRAINT "FormationSlot_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormationSlot" ADD CONSTRAINT "FormationSlot_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "MatchParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MatchPayment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "matchId" UUID NOT NULL, "userId" UUID NOT NULL,
  "participantId" UUID NOT NULL, "team" "TeamSide" NOT NULL, "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'ZAR', "status" "MatchPaymentStatus" NOT NULL DEFAULT 'SUCCEEDED',
  "walletTransactionId" UUID NOT NULL, "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchPayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MatchPayment_participantId_key" ON "MatchPayment"("participantId");
CREATE UNIQUE INDEX "MatchPayment_walletTransactionId_key" ON "MatchPayment"("walletTransactionId");
CREATE UNIQUE INDEX "MatchPayment_idempotencyKey_key" ON "MatchPayment"("idempotencyKey");
CREATE INDEX "MatchPayment_matchId_team_status_idx" ON "MatchPayment"("matchId", "team", "status");
CREATE INDEX "MatchPayment_userId_idx" ON "MatchPayment"("userId");
ALTER TABLE "MatchPayment" ADD CONSTRAINT "MatchPayment_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchPayment" ADD CONSTRAINT "MatchPayment_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchPayment" ADD CONSTRAINT "MatchPayment_walletTransactionId_fkey" FOREIGN KEY ("walletTransactionId") REFERENCES "WalletTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ParticipantCancellation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "matchId" UUID NOT NULL, "userId" UUID NOT NULL,
  "matchPaymentId" UUID NOT NULL, "originalTeam" "TeamSide" NOT NULL,
  "cancelledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "originalAmountCents" INTEGER NOT NULL,
  "initialCreditCents" INTEGER NOT NULL, "replacementCreditCents" INTEGER NOT NULL DEFAULT 0,
  "replacementParticipantId" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ParticipantCancellation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ParticipantCancellation_matchPaymentId_key" ON "ParticipantCancellation"("matchPaymentId");
CREATE UNIQUE INDEX "ParticipantCancellation_replacementParticipantId_key" ON "ParticipantCancellation"("replacementParticipantId");
CREATE INDEX "ParticipantCancellation_matchId_originalTeam_cancelledAt_idx" ON "ParticipantCancellation"("matchId", "originalTeam", "cancelledAt");
CREATE INDEX "ParticipantCancellation_userId_idx" ON "ParticipantCancellation"("userId");
ALTER TABLE "ParticipantCancellation" ADD CONSTRAINT "ParticipantCancellation_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParticipantCancellation" ADD CONSTRAINT "ParticipantCancellation_matchPaymentId_fkey" FOREIGN KEY ("matchPaymentId") REFERENCES "MatchPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ParticipantCancellation" ADD CONSTRAINT "ParticipantCancellation_replacementParticipantId_fkey" FOREIGN KEY ("replacementParticipantId") REFERENCES "MatchParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MatchResult" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "matchId" UUID NOT NULL, "homeScore" INTEGER NOT NULL, "awayScore" INTEGER NOT NULL, "submittedById" UUID NOT NULL, "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MatchResult_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "MatchResult_matchId_key" ON "MatchResult"("matchId");
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "MatchScorer" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "matchResultId" UUID NOT NULL, "participantId" UUID NOT NULL, "team" "TeamSide" NOT NULL, "goals" INTEGER NOT NULL, CONSTRAINT "MatchScorer_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "MatchScorer_matchResultId_participantId_key" ON "MatchScorer"("matchResultId", "participantId");
ALTER TABLE "MatchScorer" ADD CONSTRAINT "MatchScorer_matchResultId_fkey" FOREIGN KEY ("matchResultId") REFERENCES "MatchResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchScorer" ADD CONSTRAINT "MatchScorer_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "MatchParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Conversation" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "directKey" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "Conversation_directKey_key" ON "Conversation"("directKey");
CREATE TABLE "ConversationParticipant" ("conversationId" UUID NOT NULL, "userId" UUID NOT NULL, "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastReadAt" TIMESTAMP(3), CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("conversationId","userId"));
CREATE INDEX "ConversationParticipant_userId_idx" ON "ConversationParticipant"("userId");
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "DirectMessage" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "conversationId" UUID NOT NULL, "senderId" UUID NOT NULL, "content" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "editedAt" TIMESTAMP(3), "deletedAt" TIMESTAMP(3), CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id"));
CREATE INDEX "DirectMessage_conversationId_createdAt_idx" ON "DirectMessage"("conversationId", "createdAt");
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Notification" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "userId" UUID NOT NULL, "type" "NotificationType" NOT NULL, "title" TEXT NOT NULL, "message" TEXT NOT NULL, "targetPath" TEXT, "readAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"));
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" DROP COLUMN "firstName", DROP COLUMN "lastName", DROP COLUMN "avatarUrl", DROP COLUMN "balanceCents";
