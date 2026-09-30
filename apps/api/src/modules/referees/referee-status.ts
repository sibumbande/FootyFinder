import type { Prisma } from '../../generated/prisma/client.js';

/** True when the user holds an active referee grant and an active account (DEC-020). */
export async function isActiveReferee(tx: Prisma.TransactionClient, userId: string) {
  const grant = await tx.refereeGrant.findFirst({
    where: { userId, revokedAt: null, user: { accountStatus: 'ACTIVE' } },
    select: { id: true },
  });
  return Boolean(grant);
}
