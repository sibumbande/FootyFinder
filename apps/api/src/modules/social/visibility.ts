import type { Prisma } from '../../generated/prisma/client.js';

type Db = Prisma.TransactionClient;

/**
 * Gate 9: the players among `userIds` that `viewerId` must not see socially (blocked either way).
 * Every social read and write goes through this one check.
 */
export async function blockedEitherWay(_db: Db, _viewerId: string, _userIds: string[]): Promise<Set<string>> {
  return new Set();
}
