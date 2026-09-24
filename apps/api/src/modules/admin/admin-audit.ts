import type { Prisma } from '../../generated/prisma/client.js';

export interface AdminAuditDraft {
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  requestId?: string;
  metadata?: Prisma.InputJsonValue;
}

export const appendAdminAudit = (tx: Prisma.TransactionClient, draft: AdminAuditDraft) =>
  tx.adminAuditLog.create({ data: draft });
