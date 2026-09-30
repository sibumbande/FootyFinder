import type { AdminReferee, RefereeRoleChangeInput } from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { appendAdminAudit } from '../admin/admin-audit.js';

const refereeSelect = {
  id: true,
  grantedAt: true,
  grantReason: true,
  user: {
    select: {
      id: true,
      email: true,
      username: true,
      accountStatus: true,
      profile: { select: { displayName: true } },
    },
  },
  grantedBy: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
} as const;

type RefereeRow = Prisma.RefereeGrantGetPayload<{ select: typeof refereeSelect }>;

const toAdminReferee = (row: RefereeRow): AdminReferee => ({
  userId: row.user.id,
  displayName: row.user.profile?.displayName ?? row.user.username,
  username: row.user.username,
  email: row.user.email,
  accountStatus: row.user.accountStatus,
  grantedAt: row.grantedAt.toISOString(),
  grantReason: row.grantReason,
  grantedBy: row.grantedBy
    ? { id: row.grantedBy.id, displayName: row.grantedBy.profile?.displayName ?? row.grantedBy.username }
    : null,
});

/** Locks the user row so a grant and a revoke for the same person never interleave. */
const lockUser = (tx: Prisma.TransactionClient, userId: string) =>
  tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;

/** True when the user holds an active referee grant and an active account (DEC-020). */
export async function isActiveReferee(tx: Prisma.TransactionClient, userId: string) {
  const grant = await tx.refereeGrant.findFirst({
    where: { userId, revokedAt: null, user: { accountStatus: 'ACTIVE' } },
    select: { id: true },
  });
  return Boolean(grant);
}

/**
 * Gate 8 / TKT-801 (DEC-020): the referee role. An admin grants or removes it on a normal account
 * (an admin may also be a referee). Each change is a permanent RefereeGrant row plus an
 * AdminAuditLog entry with the written reason. The routes also require a fresh MFA check (D25).
 */
export class RefereeRoleService {
  async list(): Promise<AdminReferee[]> {
    const rows = await prisma.refereeGrant.findMany({
      where: { revokedAt: null },
      select: refereeSelect,
      orderBy: { grantedAt: 'asc' },
    });
    return rows.map(toAdminReferee);
  }

  async grant(userId: string, adminUserId: string, input: RefereeRoleChangeInput, requestId: string) {
    const grant = await serializableTransaction(async (tx) => {
      await lockUser(tx, userId);
      const user = await tx.user.findUnique({ where: { id: userId }, select: { accountStatus: true } });
      if (!user) throw new AppError(404, 'Player not found.', 'PLAYER_NOT_FOUND');
      if (user.accountStatus !== 'ACTIVE')
        throw new AppError(409, 'Only an active account can be made a referee.', 'REFEREE_ACCOUNT_RESTRICTED');
      const active = await tx.refereeGrant.findFirst({ where: { userId, revokedAt: null } });
      if (active) throw new AppError(409, 'This person is already a referee.', 'ALREADY_REFEREE');
      const created = await tx.refereeGrant.create({
        data: { userId, grantedById: adminUserId, grantReason: input.reason },
        select: refereeSelect,
      });
      await appendAdminAudit(tx, {
        actorUserId: adminUserId,
        action: 'REFEREE_GRANTED',
        entityType: 'USER',
        entityId: userId,
        requestId,
        metadata: { refereeGrantId: created.id, reason: input.reason },
      });
      return created;
    });
    return toAdminReferee(grant);
  }

  async revoke(userId: string, adminUserId: string, input: RefereeRoleChangeInput, requestId: string) {
    await serializableTransaction(async (tx) => {
      await lockUser(tx, userId);
      const active = await tx.refereeGrant.findFirst({ where: { userId, revokedAt: null } });
      if (!active) throw new AppError(404, 'This person is not a referee.', 'NOT_A_REFEREE');
      await tx.refereeGrant.update({
        where: { id: active.id },
        data: { revokedAt: new Date(), revokedById: adminUserId, revokeReason: input.reason },
      });
      await appendAdminAudit(tx, {
        actorUserId: adminUserId,
        action: 'REFEREE_REVOKED',
        entityType: 'USER',
        entityId: userId,
        requestId,
        metadata: { refereeGrantId: active.id, reason: input.reason },
      });
    });
    return { userId, revoked: true as const };
  }
}
