import type { Prisma } from '../../generated/prisma/client.js';
import { hiddenAccountIds } from '../users/hidden-account.js';

type Db = Prisma.TransactionClient;

/**
 * Gate 9 / TKT-903: the players among `userIds` that `viewerId` must not see or reach socially
 * because either of them blocked the other. Every social read and write goes through this check.
 * CEO batch 5, item 2: players who are deleting (or have deleted) their account are in the set too, so
 * they disappear from search, friends, requests, "played with", recruitment and DMs in the same way.
 */
export async function blockedEitherWay(db: Db, viewerId: string, userIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(userIds)].filter((id) => id !== viewerId);
  if (!ids.length) return new Set();
  const [blocked, hidden] = await Promise.all([blocksEitherWay(db, viewerId, ids), hiddenAccountIds(db, ids)]);
  return new Set([...blocked, ...hidden]);
}

/**
 * Blocks only. Used where a group of people stands for a Team (its Owner and Captains): a Team stays
 * visible while one of its Captains is deleting their account.
 */
export async function blocksEitherWay(db: Db, viewerId: string, userIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(userIds)].filter((id) => id !== viewerId);
  if (!ids.length) return new Set();
  const rows = await db.userBlock.findMany({
    where: { OR: [{ blockerId: viewerId, blockedId: { in: ids } }, { blockedId: viewerId, blockerId: { in: ids } }] },
    select: { blockerId: true, blockedId: true },
  });
  return new Set(rows.map((row) => (row.blockerId === viewerId ? row.blockedId : row.blockerId)));
}

/** Only the players `viewerId` blocked (never reveals who blocked the viewer). */
export async function blockedByViewer(db: Db, viewerId: string, userIds?: string[]): Promise<Set<string>> {
  const rows = await db.userBlock.findMany({
    where: { blockerId: viewerId, ...(userIds ? { blockedId: { in: userIds } } : {}) },
    select: { blockedId: true },
  });
  return new Set(rows.map(({ blockedId }) => blockedId));
}

export const isBlockedEitherWay = async (db: Db, a: string, b: string) => (await blockedEitherWay(db, a, [b])).has(b);
