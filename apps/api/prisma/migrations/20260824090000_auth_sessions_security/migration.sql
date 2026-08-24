CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED');

ALTER TABLE "User"
ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgentHash" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuthSession_userId_revokedAt_expiresAt_idx"
ON "AuthSession"("userId", "revokedAt", "expiresAt");

CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

ALTER TABLE "AuthSession"
ADD CONSTRAINT "AuthSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Match" ADD COLUMN "inviteTokenHash" TEXT;

CREATE UNIQUE INDEX "Match_inviteTokenHash_key" ON "Match"("inviteTokenHash");

CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE "Match"
SET "inviteTokenHash" = encode(digest("inviteToken", 'sha256'), 'hex'),
    "inviteToken" = NULL
WHERE "inviteToken" IS NOT NULL;
