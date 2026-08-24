import type { AdminAuditEntry } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import { toPublicUser } from '../users/user.mapper.js';

export class AdminService {
  async auditLog(): Promise<AdminAuditEntry[]> {
    const rows = await prisma.adminAuditLog.findMany({
      take: 100,
      orderBy: { createdAt: 'desc' },
      include: {
        actor: {
          include: {
            profile: { include: { preferredPositions: true } },
          },
        },
      },
    });
    return rows.map((row) => {
      const actor = row.actor ? toPublicUser(row.actor) : undefined;
      return {
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId ?? undefined,
        requestId: row.requestId ?? undefined,
        metadata:
          row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
            ? (row.metadata as Record<string, unknown>)
            : undefined,
        createdAt: row.createdAt.toISOString(),
        actor: actor
          ? { id: actor.id, username: actor.username, displayName: actor.displayName }
          : undefined,
      };
    });
  }
}
