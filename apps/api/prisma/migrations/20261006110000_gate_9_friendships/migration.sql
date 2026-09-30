-- Gate 9 / TKT-901 (section 3A Friendship rule, CEO Gate 9 decisions): friend requests and
-- friendships. One pending request per pair (either direction), 30-day expiry, at most 100 pending
-- outgoing and 20 new requests per rolling day (requests to someone you shared a match Lineup
-- Record with do not count towards the 20). A player may turn off incoming requests. After a
-- decline the requester may ask again at any time. Friendships are stored once per pair, lowest
-- user id first. No money is involved. Additive only.
BEGIN;

ALTER TABLE "User" ADD COLUMN "friendRequestsEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "FriendRequest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "requesterId" UUID NOT NULL,
  "recipientId" UUID NOT NULL,
  "pairKey" TEXT NOT NULL,
  "status" "FriendRequestStatus" NOT NULL DEFAULT 'PENDING',
  "sharedLineup" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FriendRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FriendRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FriendRequest_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FriendRequest_not_self_check" CHECK ("requesterId" <> "recipientId"),
  CONSTRAINT "FriendRequest_responded_check" CHECK (("status" = 'PENDING') = ("respondedAt" IS NULL))
);
CREATE UNIQUE INDEX "FriendRequest_one_pending_per_pair" ON "FriendRequest"("pairKey") WHERE "status" = 'PENDING';
CREATE INDEX "FriendRequest_requesterId_status_createdAt_idx" ON "FriendRequest"("requesterId", "status", "createdAt");
CREATE INDEX "FriendRequest_recipientId_status_createdAt_idx" ON "FriendRequest"("recipientId", "status", "createdAt");

CREATE TABLE "Friendship" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userLowId" UUID NOT NULL,
  "userHighId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Friendship_userLowId_fkey" FOREIGN KEY ("userLowId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Friendship_userHighId_fkey" FOREIGN KEY ("userHighId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Friendship_ordered_check" CHECK ("userLowId" < "userHighId")
);
CREATE UNIQUE INDEX "Friendship_userLowId_userHighId_key" ON "Friendship"("userLowId", "userHighId");
CREATE INDEX "Friendship_userHighId_idx" ON "Friendship"("userHighId");

COMMIT;
