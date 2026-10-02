import type { SocialPlayerCard } from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { orderedPair, pairKey } from './friend-rules.js';
import { socialCardSelect, toSocialCard } from './friends.service.js';
import { isHiddenAccount } from '../users/hidden-account.js';

type Db = Prisma.TransactionClient;
type BlockHook = (tx: Db, blockerId: string, blockedId: string, now: Date) => Promise<unknown>;

/** Other Gate 9 features (team invites, join requests) register what a block must also close. */
const blockHooks: BlockHook[] = [];
export const onBlock = (hook: BlockHook) => {
  blockHooks.push(hook);
};

/**
 * Gate 9 / TKT-903: block and unblock. Blocking ends any friendship and pending friend request
 * between the two players in the same transaction; unblocking restores nothing. The blocked player
 * is never told. Shared teams, matches, lineups and results are left exactly as they are.
 */
export class BlocksService {
  async block(viewerId: string, targetId: string, now = new Date()) {
    if (viewerId === targetId) throw new AppError(400, "You can't block yourself.", 'BLOCK_SELF');
    await serializableTransaction(async (tx) => {
      if (!(await tx.user.findUnique({ where: { id: targetId }, select: { id: true } })))
        throw new AppError(404, 'Player not found.', 'PLAYER_NOT_FOUND');
      await tx.userBlock.createMany({ data: [{ blockerId: viewerId, blockedId: targetId }], skipDuplicates: true });
      await tx.friendship.deleteMany({ where: orderedPair(viewerId, targetId) });
      await tx.friendRequest.updateMany({
        where: { pairKey: pairKey(viewerId, targetId), status: 'PENDING' },
        data: { status: 'CANCELLED', respondedAt: now },
      });
      for (const hook of blockHooks) await hook(tx, viewerId, targetId, now);
    });
    return { userId: targetId, blocked: true };
  }

  async unblock(viewerId: string, targetId: string) {
    await prisma.userBlock.deleteMany({ where: { blockerId: viewerId, blockedId: targetId } });
    return { userId: targetId, blocked: false };
  }

  /** The players you blocked, for the "Blocked players" list and hiding their chat messages. */
  async list(viewerId: string): Promise<SocialPlayerCard[]> {
    const rows = await prisma.userBlock.findMany({
      where: { blockerId: viewerId },
      include: { blocked: { select: socialCardSelect } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.filter(({ blocked }) => !isHiddenAccount(blocked.accountStatus)).map(({ blocked }) => toSocialCard(blocked, { userId: blocked.id, state: 'UNAVAILABLE', blockedByYou: true }));
  }
}
