import { DELETED_PLAYER_NAME } from '@footy-finder/shared';
import type { AccountStatus, Prisma } from '../../generated/prisma/client.js';

/**
 * CEO batch 5, items 2-3: a player who asked to delete their account (14-day grace) or whose account was
 * anonymised is hidden from every list (search, Social, friends, leaderboards, upcoming lineups, recruitment)
 * and, wherever an old record still shows them (past lineups, results, chats, DMs), appears only as
 * "Deleted player": no username, photo or profile details.
 */
export const HIDDEN_ACCOUNT_STATUSES = ['PENDING_DELETION', 'DELETED'] as const satisfies readonly AccountStatus[];

export const isHiddenAccount = (status: string | null | undefined) =>
  status === 'PENDING_DELETION' || status === 'DELETED';

/** Prisma filter for "a player other people may see". */
export const visibleAccountWhere = {
  accountStatus: { notIn: [...HIDDEN_ACCOUNT_STATUSES] },
} satisfies Prisma.UserWhereInput;

/** The ids among `userIds` that belong to hidden accounts. */
export async function hiddenAccountIds(db: Prisma.TransactionClient, userIds: string[]) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Set<string>();
  const rows = await db.user.findMany({
    where: { id: { in: ids }, accountStatus: { in: [...HIDDEN_ACCOUNT_STATUSES] } },
    select: { id: true },
  });
  return new Set(rows.map(({ id }) => id));
}

/** A stored name (for example a lineup snapshot, which the database never lets us change). */
export const shownName = (status: string | null | undefined, name: string) =>
  isHiddenAccount(status) ? DELETED_PLAYER_NAME : name;
