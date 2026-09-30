-- Gate 9 / TKT-903 (section 3A Blocking rule, CEO D9/D10): a player blocks another player.
-- Blocking is bilateral for social features: neither sees the other in search, friends, requests,
-- recruitment posts or looking cards, and neither can send the other friend requests, direct
-- messages, targeted team invites or join requests. Blocking ends any friendship and pending
-- request between them. Shared teams, matches, lineups and results keep both players; nobody is
-- removed. The blocked player is never told. Additive only.
BEGIN;

CREATE TABLE "UserBlock" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "blockerId" UUID NOT NULL,
  "blockedId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserBlock_not_self_check" CHECK ("blockerId" <> "blockedId")
);
CREATE UNIQUE INDEX "UserBlock_blockerId_blockedId_key" ON "UserBlock"("blockerId", "blockedId");
CREATE INDEX "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");

COMMIT;
