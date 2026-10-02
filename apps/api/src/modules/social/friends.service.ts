import { DELETED_PLAYER_NAME } from '@footy-finder/shared';
import type {
  AddAllResult,
  FriendRequestView,
  FriendRequestsView,
  PlayedWithView,
  Relationship,
  SocialPlayerCard,
  SocialSettings,
  SocialSummary,
} from '@footy-finder/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { playerAvatarUrl } from '../users/user.mapper.js';
import { isHiddenAccount } from '../users/hidden-account.js';
import {
  dailyWindowStart,
  friendRequestExpiresAt,
  orderedPair,
  pairKey,
  relationshipState,
  sendLimitRefusal,
} from './friend-rules.js';
import { blockedByViewer, blockedEitherWay } from './visibility.js';

type Db = Prisma.TransactionClient;

export const socialCardSelect = {
  id: true,
  username: true,
  accountStatus: true,
  onboardingCompletedAt: true,
  friendRequestsEnabled: true,
  profile: {
    select: {
      displayName: true,
      avatarUrl: true,
      homeArea: true,
      city: { select: { name: true } },
      photo: { select: { hiddenAt: true } },
      preferredPositions: { orderBy: { sortOrder: 'asc' as const }, select: { position: true } },
    },
  },
} satisfies Prisma.UserSelect;
export type SocialCardUser = Prisma.UserGetPayload<{ select: typeof socialCardSelect }>;

export const toSocialCard = (user: SocialCardUser, relationship: Relationship): SocialPlayerCard =>
  isHiddenAccount(user.accountStatus)
    ? { id: user.id, username: '', displayName: DELETED_PLAYER_NAME, avatarUrl: null, city: null, homeArea: null, preferredPositions: [], relationship: { userId: user.id, state: 'UNAVAILABLE' } }
    : {
  id: user.id,
  username: user.username,
  displayName: user.profile?.displayName ?? user.username,
  avatarUrl: playerAvatarUrl(user.id, user.profile),
  city: user.profile?.city?.name ?? null,
  homeArea: user.profile?.homeArea ?? null,
  preferredPositions: user.profile?.preferredPositions.map(({ position }) => position) ?? [],
  relationship,
};

const requestable = (user: { accountStatus: string; onboardingCompletedAt: Date | null; friendRequestsEnabled: boolean }) =>
  user.accountStatus === 'ACTIVE' && Boolean(user.onboardingCompletedAt) && user.friendRequestsEnabled;

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const unavailable = () =>
  new AppError(403, "You can't send this player a friend request.", 'FRIEND_REQUEST_UNAVAILABLE');

/** Players who were in the same match's Lineup Record (either side, starter or sub). */
export async function sharedLineup(db: Db, a: string, b: string) {
  const rows = await db.$queryRaw<Array<{ found: number }>>`
    SELECT 1 AS "found" FROM "MatchLineupEntry" mine
    JOIN "MatchLineupEntry" theirs ON theirs."matchId" = mine."matchId"
    WHERE mine."userId" = ${a}::uuid AND theirs."userId" = ${b}::uuid
    LIMIT 1`;
  return rows.length > 0;
}

/**
 * Gate 9 / TKT-901: friend requests and friendships (section 3A Friendship rule, CEO decisions).
 * Pending requests past their 30-day expiry are treated as expired everywhere and are marked
 * EXPIRED whenever the pair is touched again.
 */
export class FriendsService {
  constructor(private readonly notifications = new NotificationsService()) {}

  /** Button state for each of `userIds` as seen by `viewerId`. */
  async relationships(viewerId: string, userIds: string[], db: Db = prisma, now = new Date()): Promise<Map<string, Relationship>> {
    const ids = [...new Set(userIds)];
    const others = ids.filter((id) => id !== viewerId);
    const [blocked, mine, friendships, pending, users] = await Promise.all([
      blockedEitherWay(db, viewerId, others),
      blockedByViewer(db, viewerId, others),
      db.friendship.findMany({
        where: { OR: [{ userLowId: viewerId, userHighId: { in: others } }, { userHighId: viewerId, userLowId: { in: others } }] },
        select: { userLowId: true, userHighId: true },
      }),
      db.friendRequest.findMany({
        where: {
          status: 'PENDING',
          expiresAt: { gt: now },
          OR: [{ requesterId: viewerId, recipientId: { in: others } }, { recipientId: viewerId, requesterId: { in: others } }],
        },
        select: { id: true, requesterId: true, recipientId: true },
      }),
      db.user.findMany({ where: { id: { in: others } }, select: { id: true, accountStatus: true, onboardingCompletedAt: true, friendRequestsEnabled: true } }),
    ]);
    const friendIds = new Set(friendships.map((row) => (row.userLowId === viewerId ? row.userHighId : row.userLowId)));
    const byId = new Map(users.map((user) => [user.id, user]));
    const result = new Map<string, Relationship>();
    for (const id of ids) {
      const outgoing = pending.find((row) => row.requesterId === viewerId && row.recipientId === id);
      const incoming = pending.find((row) => row.recipientId === viewerId && row.requesterId === id);
      const user = byId.get(id);
      result.set(id, {
        userId: id,
        ...relationshipState({
          self: id === viewerId,
          blocked: blocked.has(id),
          friends: friendIds.has(id),
          outgoingRequestId: outgoing?.id,
          incomingRequestId: incoming?.id,
          requestable: Boolean(user && requestable(user)),
        }),
        ...(mine.has(id) ? { blockedByYou: true } : {}),
      });
    }
    return result;
  }

  async relationshipList(viewerId: string, userIds: string[]) {
    return [...(await this.relationships(viewerId, userIds)).values()];
  }

  private async cards(viewerId: string, users: SocialCardUser[], db: Db = prisma) {
    const relationships = await this.relationships(viewerId, users.map(({ id }) => id), db);
    return users.map((user) => toSocialCard(user, relationships.get(user.id)!));
  }

  /** Discover: search by display name or username; with no search, players you played with who aren't friends yet. */
  async search(viewerId: string, query: { q?: string; cityId?: string }) {
    const friendIds = await this.friendIds(viewerId);
    const q = query.q && query.q.length >= 2 ? query.q : undefined;
    let users: SocialCardUser[];
    if (q) {
      users = await prisma.user.findMany({
        where: {
          id: { notIn: [viewerId, ...friendIds] },
          accountStatus: 'ACTIVE',
          onboardingCompletedAt: { not: null },
          OR: [{ username: { contains: q, mode: 'insensitive' } }, { profile: { displayName: { contains: q, mode: 'insensitive' } } }],
          ...(query.cityId ? { profile: { cityId: query.cityId } } : {}),
        },
        select: socialCardSelect,
        orderBy: { username: 'asc' },
        take: 30,
      });
    } else {
      const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
        SELECT theirs."userId", max(mine."recordedAt") AS "lastPlayed" FROM "MatchLineupEntry" mine
        JOIN "MatchLineupEntry" theirs ON theirs."matchId" = mine."matchId" AND theirs."userId" <> mine."userId"
        WHERE mine."userId" = ${viewerId}::uuid AND theirs."didNotPlay" = false
        GROUP BY theirs."userId" ORDER BY "lastPlayed" DESC LIMIT 60`;
      const ids = rows.map(({ userId }) => userId).filter((id) => !friendIds.includes(id));
      const found = await prisma.user.findMany({
        where: { id: { in: ids }, accountStatus: 'ACTIVE', onboardingCompletedAt: { not: null } },
        select: socialCardSelect,
      });
      users = ids.map((id) => found.find((user) => user.id === id)).filter((user): user is SocialCardUser => Boolean(user)).slice(0, 20);
    }
    const blocked = await blockedEitherWay(prisma, viewerId, users.map(({ id }) => id));
    return this.cards(viewerId, users.filter(({ id }) => !blocked.has(id)));
  }

  private async friendIds(viewerId: string, db: Db = prisma) {
    const rows = await db.friendship.findMany({
      where: { OR: [{ userLowId: viewerId }, { userHighId: viewerId }] },
      select: { userLowId: true, userHighId: true },
    });
    return rows.map((row) => (row.userLowId === viewerId ? row.userHighId : row.userLowId));
  }

  async friends(viewerId: string): Promise<SocialPlayerCard[]> {
    const ids = await this.friendIds(viewerId);
    const blocked = await blockedEitherWay(prisma, viewerId, ids);
    const users = await prisma.user.findMany({
      where: { id: { in: ids.filter((id) => !blocked.has(id)) } },
      select: socialCardSelect,
    });
    const cards = await this.cards(viewerId, users);
    return cards.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async requests(viewerId: string, now = new Date()): Promise<FriendRequestsView> {
    const rows = await prisma.friendRequest.findMany({
      where: { status: 'PENDING', expiresAt: { gt: now }, OR: [{ requesterId: viewerId }, { recipientId: viewerId }] },
      include: { requester: { select: socialCardSelect }, recipient: { select: socialCardSelect } },
      orderBy: { createdAt: 'desc' },
    });
    const otherIds = rows.map((row) => (row.requesterId === viewerId ? row.recipientId : row.requesterId));
    const [relationships, blocked] = await Promise.all([
      this.relationships(viewerId, otherIds),
      blockedEitherWay(prisma, viewerId, otherIds),
    ]);
    const view = (row: (typeof rows)[number]): FriendRequestView => {
      const other = row.requesterId === viewerId ? row.recipient : row.requester;
      return {
        id: row.id,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        player: toSocialCard(other, relationships.get(other.id)!),
      };
    };
    const visible = rows.filter((row) => !blocked.has(row.requesterId === viewerId ? row.recipientId : row.requesterId));
    return {
      incoming: visible.filter((row) => row.recipientId === viewerId).map(view),
      outgoing: visible.filter((row) => row.requesterId === viewerId).map(view),
    };
  }

  async summary(viewerId: string, now = new Date()): Promise<SocialSummary> {
    const [friendIds, incomingRequests, unread] = await Promise.all([
      this.friendIds(viewerId),
      prisma.friendRequest.findMany({ where: { recipientId: viewerId, status: 'PENDING', expiresAt: { gt: now } }, select: { requesterId: true } }),
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS "count" FROM "ConversationParticipant" cp
        WHERE cp."userId" = ${viewerId}::uuid AND EXISTS (
          SELECT 1 FROM "DirectMessage" m
          WHERE m."conversationId" = cp."conversationId" AND m."senderId" <> ${viewerId}::uuid AND m."deletedAt" IS NULL
            AND (cp."lastReadAt" IS NULL OR m."createdAt" > cp."lastReadAt"))`,
    ]);
    const blocked = await blockedEitherWay(prisma, viewerId, [...friendIds, ...incomingRequests.map(({ requesterId }) => requesterId)]);
    return {
      friends: friendIds.filter((id) => !blocked.has(id)).length,
      incomingRequests: incomingRequests.filter(({ requesterId }) => !blocked.has(requesterId)).length,
      unreadConversations: Number(unread[0]?.count ?? 0),
    };
  }

  async settings(viewerId: string): Promise<SocialSettings> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: viewerId }, select: { friendRequestsEnabled: true } });
    return { friendRequestsEnabled: user.friendRequestsEnabled };
  }

  async updateSettings(viewerId: string, input: SocialSettings): Promise<SocialSettings> {
    const user = await prisma.user.update({ where: { id: viewerId }, data: { friendRequestsEnabled: input.friendRequestsEnabled }, select: { friendRequestsEnabled: true } });
    return { friendRequestsEnabled: user.friendRequestsEnabled };
  }

  /** Sends a request, or accepts the other player's pending request if there is one. */
  async send(viewerId: string, targetId: string, now = new Date()): Promise<Relationship> {
    if (viewerId === targetId) throw new AppError(400, "You can't add yourself as a friend.", 'FRIEND_REQUEST_SELF');
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await serializableTransaction((tx) => this.sendInTx(tx, viewerId, targetId, now));
        this.notifications.publishPersistedMany(result.notifications);
        return result.relationship;
      } catch (error) {
        // A request the other way committed first: the next attempt accepts it.
        if (!isUniqueViolation(error) || attempt > 0) throw error;
      }
    }
  }

  private async sendInTx(tx: Db, viewerId: string, targetId: string, now: Date) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${viewerId}::uuid FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, accountStatus: true, onboardingCompletedAt: true, friendRequestsEnabled: true } });
    if (!target || (await blockedEitherWay(tx, viewerId, [targetId])).has(targetId)) throw unavailable();
    if (await tx.friendship.findUnique({ where: { userLowId_userHighId: orderedPair(viewerId, targetId) } }))
      return { relationship: { userId: targetId, state: 'FRIENDS' as const }, notifications: [] };
    const key = pairKey(viewerId, targetId);
    await tx.friendRequest.updateMany({ where: { pairKey: key, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED', respondedAt: now } });
    const pending = await tx.friendRequest.findFirst({ where: { pairKey: key, status: 'PENDING' } });
    if (pending?.requesterId === viewerId)
      return { relationship: { userId: targetId, state: 'REQUESTED' as const, requestId: pending.id }, notifications: [] };
    if (pending) return this.acceptInTx(tx, pending.id, viewerId, now);
    if (!requestable(target))
      throw new AppError(403, "This player isn't accepting friend requests.", 'FRIEND_REQUESTS_DISABLED');
    const [pendingOutgoing, sentToday, shared] = await Promise.all([
      tx.friendRequest.count({ where: { requesterId: viewerId, status: 'PENDING', expiresAt: { gt: now } } }),
      tx.friendRequest.count({ where: { requesterId: viewerId, sharedLineup: false, createdAt: { gt: dailyWindowStart(now) } } }),
      sharedLineup(tx, viewerId, targetId),
    ]);
    const refusal = sendLimitRefusal({ pendingOutgoing, sentToday, sharedLineup: shared });
    if (refusal === 'PENDING_LIMIT')
      throw new AppError(409, 'You have 100 friend requests waiting for an answer. Wait for some to be answered or cancel some first.', 'FRIEND_REQUEST_PENDING_LIMIT');
    if (refusal === 'DAILY_LIMIT')
      throw new AppError(429, 'You have sent 20 friend requests in the last 24 hours. Try again later.', 'FRIEND_REQUEST_DAILY_LIMIT');
    const request = await tx.friendRequest.create({
      data: { requesterId: viewerId, recipientId: targetId, pairKey: key, sharedLineup: shared, expiresAt: friendRequestExpiresAt(now) },
    });
    const sender = await tx.user.findUniqueOrThrow({ where: { id: viewerId }, select: { username: true, profile: { select: { displayName: true } } } });
    const notifications = await persistNotifications(tx, [{
      userId: targetId,
      type: 'FRIEND_REQUEST_RECEIVED',
      title: 'Friend request',
      message: `${sender.profile?.displayName ?? sender.username} wants to be friends on FootyFinder.`,
      targetPath: '/social?tab=friends',
      dedupeKey: notificationDedupeKey('friend-request', request.id, 'received'),
    }]);
    return { relationship: { userId: targetId, state: 'REQUESTED' as const, requestId: request.id }, notifications };
  }

  private async lockedRequest(tx: Db, requestId: string) {
    await tx.$queryRaw`SELECT "id" FROM "FriendRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE`;
    const request = await tx.friendRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new AppError(404, 'Friend request not found.', 'FRIEND_REQUEST_NOT_FOUND');
    return request;
  }

  private async acceptInTx(tx: Db, requestId: string, viewerId: string, now: Date) {
    const request = await this.lockedRequest(tx, requestId);
    if (request.recipientId !== viewerId) throw new AppError(404, 'Friend request not found.', 'FRIEND_REQUEST_NOT_FOUND');
    const pair = orderedPair(request.requesterId, request.recipientId);
    if (request.status === 'ACCEPTED' && (await tx.friendship.findUnique({ where: { userLowId_userHighId: pair } })))
      return { relationship: { userId: request.requesterId, state: 'FRIENDS' as const }, notifications: [] };
    if (request.status !== 'PENDING') throw new AppError(409, 'This friend request is no longer open.', 'FRIEND_REQUEST_CLOSED');
    if (request.expiresAt <= now) {
      await tx.friendRequest.update({ where: { id: request.id }, data: { status: 'EXPIRED', respondedAt: now } });
      throw new AppError(410, 'This friend request has expired.', 'FRIEND_REQUEST_EXPIRED');
    }
    if ((await blockedEitherWay(tx, viewerId, [request.requesterId])).has(request.requesterId)) throw unavailable();
    await tx.friendRequest.update({ where: { id: request.id }, data: { status: 'ACCEPTED', respondedAt: now } });
    await tx.friendship.createMany({ data: [pair], skipDuplicates: true });
    const accepter = await tx.user.findUniqueOrThrow({ where: { id: viewerId }, select: { username: true, profile: { select: { displayName: true } } } });
    const notifications = await persistNotifications(tx, [{
      userId: request.requesterId,
      type: 'FRIEND_REQUEST_ACCEPTED',
      title: 'Friend request accepted',
      message: `${accepter.profile?.displayName ?? accepter.username} accepted your friend request.`,
      targetPath: `/players/${viewerId}`,
      dedupeKey: notificationDedupeKey('friend-request', request.id, 'accepted'),
    }]);
    return { relationship: { userId: request.requesterId, state: 'FRIENDS' as const }, notifications };
  }

  async accept(viewerId: string, requestId: string, now = new Date()): Promise<Relationship> {
    const result = await serializableTransaction((tx) => this.acceptInTx(tx, requestId, viewerId, now));
    this.notifications.publishPersistedMany(result.notifications);
    return result.relationship;
  }

  /** Decline (recipient) or cancel (requester). Both are silent; the requester may ask again at any time. */
  async close(viewerId: string, requestId: string, action: 'DECLINE' | 'CANCEL', now = new Date()): Promise<Relationship> {
    return serializableTransaction(async (tx) => {
      const request = await this.lockedRequest(tx, requestId);
      const mine = action === 'DECLINE' ? request.recipientId === viewerId : request.requesterId === viewerId;
      if (!mine) throw new AppError(404, 'Friend request not found.', 'FRIEND_REQUEST_NOT_FOUND');
      const otherId = action === 'DECLINE' ? request.requesterId : request.recipientId;
      if (request.status === 'PENDING')
        await tx.friendRequest.update({
          where: { id: request.id },
          data: { status: request.expiresAt <= now ? 'EXPIRED' : action === 'DECLINE' ? 'DECLINED' : 'CANCELLED', respondedAt: now },
        });
      return (await this.relationships(viewerId, [otherId], tx, now)).get(otherId)!;
    });
  }

  async remove(viewerId: string, friendUserId: string): Promise<Relationship> {
    if (viewerId === friendUserId) throw new AppError(400, "You can't remove yourself.", 'FRIEND_REQUEST_SELF');
    await prisma.friendship.deleteMany({ where: orderedPair(viewerId, friendUserId) });
    return (await this.relationships(viewerId, [friendUserId])).get(friendUserId)!;
  }

  /** CEO Gate 9: "Players you played with" on a finished match: the Lineup Record, both sides. */
  async playedWith(viewerId: string, matchId: string): Promise<PlayedWithView> {
    const match = await prisma.match.findUnique({ where: { id: matchId }, select: { id: true, status: true, refereeUserId: true } });
    if (!match || !['AWAITING_RESULT', 'COMPLETED'].includes(match.status))
      throw new AppError(404, 'This match has not finished yet.', 'MATCH_NOT_FINISHED');
    const entries = await prisma.matchLineupEntry.findMany({
      where: { matchId },
      select: { userId: true, side: true, didNotPlay: true, slotIndex: true, role: true },
      orderBy: [{ side: 'asc' }, { role: 'asc' }, { slotIndex: 'asc' }],
    });
    const mine = entries.find((entry) => entry.userId === viewerId);
    if (!mine && match.refereeUserId !== viewerId)
      throw new AppError(403, 'Only players in this match can see who they played with.', 'PLAYED_WITH_FORBIDDEN');
    const others = entries.filter((entry) => entry.userId !== viewerId && !entry.didNotPlay);
    const blocked = await blockedEitherWay(prisma, viewerId, others.map(({ userId }) => userId));
    const visible = others.filter(({ userId }) => !blocked.has(userId));
    const users = await prisma.user.findMany({ where: { id: { in: visible.map(({ userId }) => userId) } }, select: socialCardSelect });
    const cards = new Map((await this.cards(viewerId, users)).map((card) => [card.id, card]));
    const players = visible
      .map((entry) => ({ ...cards.get(entry.userId)!, side: entry.side, teammate: Boolean(mine && mine.side === entry.side) }))
      .sort((a, b) => Number(b.teammate) - Number(a.teammate));
    return { matchId, players };
  }

  /** "Add all": one request to every player you can still ask; stops at the 100 pending cap. */
  async addAll(viewerId: string, matchId: string): Promise<AddAllResult> {
    const { players } = await this.playedWith(viewerId, matchId);
    let sent = 0;
    let skipped = 0;
    for (const player of players) {
      if (player.relationship.state !== 'CAN_REQUEST' && player.relationship.state !== 'INCOMING') {
        skipped += 1;
        continue;
      }
      try {
        await this.send(viewerId, player.id);
        sent += 1;
      } catch (error) {
        if ((error as AppError).code === 'FRIEND_REQUEST_PENDING_LIMIT') return { sent, skipped: players.length - sent, limitReached: true };
        if (error instanceof AppError && error.statusCode < 500) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }
    return { sent, skipped, limitReached: false };
  }
}
