-- Gate 7 / TKT-710: one permanent team-owned conversation (section 3A "Team chat").
--  * TeamMessage: the team's retained chat history. Current members read and send it; a removed
--    member loses all access at once (checked on every request and on the socket room).
--  * TeamChatReadState: when each member last read the chat, for the single first-unread notice.
-- Kept separate from match lobby chat. Additive only. No index uses a function.
BEGIN;

CREATE TABLE "TeamMessage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "teamId" UUID NOT NULL,
  "senderId" UUID NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamMessage_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeamMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamMessage_content_check" CHECK (char_length("content") BETWEEN 1 AND 2000)
);
CREATE INDEX "TeamMessage_teamId_createdAt_id_idx" ON "TeamMessage"("teamId", "createdAt", "id");

CREATE TABLE "TeamChatReadState" (
  "teamId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "lastReadAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamChatReadState_pkey" PRIMARY KEY ("teamId", "userId"),
  CONSTRAINT "TeamChatReadState_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeamChatReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TeamChatReadState_userId_idx" ON "TeamChatReadState"("userId");

COMMIT;
