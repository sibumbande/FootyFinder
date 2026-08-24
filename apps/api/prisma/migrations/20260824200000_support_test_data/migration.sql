ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SUPPORT_REPLY';

CREATE TYPE "SupportTicketCategory" AS ENUM ('GENERAL', 'ACCOUNT', 'MATCH', 'TEAM', 'PAYMENT', 'SAFETY');
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED');
CREATE TYPE "SupportTicketPriority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "SupportMessageAuthorRole" AS ENUM ('USER', 'ADMIN');

CREATE TABLE "SupportTicket" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "referenceCode" TEXT NOT NULL,
  "createdByUserId" UUID NOT NULL, "assignedAdminUserId" UUID,
  "subject" TEXT NOT NULL, "category" "SupportTicketCategory" NOT NULL,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "SupportTicketPriority" NOT NULL DEFAULT 'NORMAL',
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3), "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportTicket_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupportTicket_assignedAdminUserId_fkey" FOREIGN KEY ("assignedAdminUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SupportTicket_referenceCode_key" ON "SupportTicket"("referenceCode");
CREATE INDEX "SupportTicket_status_priority_lastMessageAt_idx" ON "SupportTicket"("status", "priority", "lastMessageAt");
CREATE INDEX "SupportTicket_createdByUserId_lastMessageAt_idx" ON "SupportTicket"("createdByUserId", "lastMessageAt");
CREATE INDEX "SupportTicket_assignedAdminUserId_status_lastMessageAt_idx" ON "SupportTicket"("assignedAdminUserId", "status", "lastMessageAt");

CREATE TABLE "SupportTicketMessage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "ticketId" UUID NOT NULL,
  "authorUserId" UUID NOT NULL, "authorRole" "SupportMessageAuthorRole" NOT NULL,
  "content" TEXT NOT NULL, "internal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportTicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportTicketMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SupportTicketMessage_ticketId_createdAt_idx" ON "SupportTicketMessage"("ticketId", "createdAt");
CREATE INDEX "SupportTicketMessage_authorUserId_createdAt_idx" ON "SupportTicketMessage"("authorUserId", "createdAt");

CREATE TABLE "TestDataBatch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "label" TEXT NOT NULL,
  "createdByAdminUserId" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TestDataBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TestDataBatch_createdByAdminUserId_fkey" FOREIGN KEY ("createdByAdminUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "TestDataBatch_createdAt_idx" ON "TestDataBatch"("createdAt");

ALTER TABLE "User" ADD COLUMN "isTestAccount" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "testDataBatchId" UUID;
ALTER TABLE "User" ADD CONSTRAINT "User_testDataBatchId_fkey" FOREIGN KEY ("testDataBatchId") REFERENCES "TestDataBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "User_isTestAccount_testDataBatchId_idx" ON "User"("isTestAccount", "testDataBatchId");
ALTER TABLE "User" ADD CONSTRAINT "User_test_batch_consistency" CHECK (("isTestAccount" = true AND "testDataBatchId" IS NOT NULL) OR ("isTestAccount" = false AND "testDataBatchId" IS NULL));
