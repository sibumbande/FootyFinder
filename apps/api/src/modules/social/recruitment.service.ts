import {
  JOIN_REQUESTS_PENDING_MAX,
  JOIN_REQUEST_EXPIRY_DAYS,
  RECRUITMENT_POST_DAYS,
  type AdminRecruitmentItem,
  type LookingCardInput,
  type LookingCardView,
  type MyLookingCard,
  type RecruitmentPostInput,
  type RecruitmentPostView,
  type RecruitmentQuery,
  type TeamJoinRequestStatus,
  type TeamJoinRequestView,
} from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { toTeamMember } from '../teams/team.mapper.js';
import { joinTeamAsMember } from '../teams/teams.repository.js';
import { onBlock } from './blocks.service.js';
import { FriendsService, socialCardSelect, toSocialCard } from './friends.service.js';
import { isHiddenAccount } from '../users/hidden-account.js';
import { blockedEitherWay, blocksEitherWay } from './visibility.js';

type Db = Prisma.TransactionClient;
const DAY_MS = 86_400_000;
const MANAGER_ROLES = ['OWNER', 'CAPTAIN'] as const;

const postInclude = {
  team: {
    select: {
      id: true, name: true, profileImageUrl: true, archivedAt: true,
      memberships: { select: { userId: true, role: true } },
    },
  },
  _count: { select: { joinRequests: { where: { status: 'ACCEPTED' } } } },
} satisfies Prisma.TeamRecruitmentPostInclude;
type PostRow = Prisma.TeamRecruitmentPostGetPayload<{ include: typeof postInclude }>;

const notFound = () => new AppError(404, 'Recruitment post not found.', 'RECRUITMENT_POST_NOT_FOUND');
const requestNotFound = () => new AppError(404, 'Join request not found.', 'JOIN_REQUEST_NOT_FOUND');
const managersOf = (post: PostRow) => post.team.memberships.filter(({ role }) => MANAGER_ROLES.includes(role as 'OWNER')).map(({ userId }) => userId);

/** A block cancels "Ask to join" requests between a player and that team's Owner or Captains (D9). */
onBlock((tx, a, b, now) =>
  tx.teamJoinRequest.updateMany({
    where: {
      status: 'PENDING',
      OR: [
        { userId: a, team: { memberships: { some: { userId: b, role: { in: [...MANAGER_ROLES] } } } } },
        { userId: b, team: { memberships: { some: { userId: a, role: { in: [...MANAGER_ROLES] } } } } },
      ],
    },
    data: { status: 'CANCELLED', respondedAt: now },
  }));

/**
 * Gate 9 / TKT-909: the team recruitment board. Teams recruiting (posts by a Team's Owner or a
 * Captain, 30-day expiry, renewable), players looking (an opt-in card), "Ask to join" (one pending
 * per player per team, at most 10 pending, 14-day expiry) and admin removal after reports.
 * Blocking hides posts and cards both ways. No money is involved anywhere.
 */
export class RecruitmentService {
  constructor(
    private readonly notifications = new NotificationsService(),
    private readonly friends = new FriendsService(),
  ) {}

  private async assertManager(db: Db, teamId: string, userId: string) {
    const team = await db.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true, archivedAt: true, memberships: { where: { userId }, select: { role: true } } },
    });
    if (!team) throw new AppError(404, 'Team not found.', 'TEAM_NOT_FOUND');
    if (team.archivedAt) throw new AppError(409, 'This team has been closed.', 'TEAM_ARCHIVED');
    if (!team.memberships.some(({ role }) => MANAGER_ROLES.includes(role as 'OWNER')))
      throw new AppError(403, 'Only the team owner or a captain can do this.', 'TEAM_FORBIDDEN');
    return team;
  }

  private toPostView(row: PostRow, viewerId: string | null, request: { id: string; status: TeamJoinRequestStatus } | null, now: Date): RecruitmentPostView {
    const membership = viewerId ? row.team.memberships.find(({ userId }) => userId === viewerId) : undefined;
    return {
      id: row.id,
      team: { id: row.team.id, name: row.team.name, profileImageUrl: row.team.profileImageUrl },
      positions: row.positions,
      playersWanted: row.playersWanted,
      joinedCount: row._count.joinRequests,
      format: row.format,
      level: row.level,
      days: row.days,
      times: row.times,
      area: row.area,
      note: row.note,
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      expired: row.expiresAt <= now,
      viewerCanManage: Boolean(membership && MANAGER_ROLES.includes(membership.role as 'OWNER')),
      viewerIsMember: Boolean(membership),
      viewerRequest: request,
    };
  }

  /** "Teams recruiting": open, unexpired posts, filtered; hidden both ways across a block. */
  async listPosts(viewerId: string | null, query: RecruitmentQuery, now = new Date()) {
    const rows = await prisma.teamRecruitmentPost.findMany({
      where: {
        status: 'OPEN',
        expiresAt: { gt: now },
        team: { archivedAt: null, ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}) },
        ...(query.format ? { format: query.format } : {}),
        ...(query.level ? { level: query.level } : {}),
        ...(query.position ? { positions: { has: query.position } } : {}),
        ...(query.area ? { area: { contains: query.area, mode: 'insensitive' } } : {}),
      },
      include: postInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    if (!viewerId) return rows.map((row) => this.toPostView(row, null, null, now));
    const blocked = await blocksEitherWay(prisma, viewerId, rows.flatMap(managersOf));
    const visible = rows.filter((row) => !managersOf(row).some((id) => blocked.has(id)));
    const requests = await prisma.teamJoinRequest.findMany({
      where: { userId: viewerId, teamId: { in: visible.map(({ teamId }) => teamId) }, status: 'PENDING', expiresAt: { gt: now } },
      select: { id: true, teamId: true, status: true },
    });
    return visible.map((row) => {
      const request = requests.find(({ teamId }) => teamId === row.teamId);
      return this.toPostView(row, viewerId, request ? { id: request.id, status: request.status } : null, now);
    });
  }

  /** The Team's own posts, including closed, expired and removed ones (Owner and Captains). */
  async teamPosts(actorId: string, teamId: string, now = new Date()) {
    await this.assertManager(prisma, teamId, actorId);
    const rows = await prisma.teamRecruitmentPost.findMany({ where: { teamId }, include: postInclude, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((row) => this.toPostView(row, actorId, null, now));
  }

  async createPost(actorId: string, teamId: string, input: RecruitmentPostInput, now = new Date()) {
    await this.assertManager(prisma, teamId, actorId);
    const row = await prisma.teamRecruitmentPost.create({
      data: { teamId, createdById: actorId, ...this.postData(input), expiresAt: new Date(now.getTime() + RECRUITMENT_POST_DAYS * DAY_MS) },
      include: postInclude,
    });
    return this.toPostView(row, actorId, null, now);
  }

  private postData(input: RecruitmentPostInput) {
    return {
      positions: input.positions, playersWanted: input.playersWanted, format: input.format, level: input.level,
      days: [...input.days].sort(), times: input.times, area: input.area, note: input.note ?? null,
    };
  }

  private async managedPost(actorId: string, teamId: string, postId: string) {
    await this.assertManager(prisma, teamId, actorId);
    const post = await prisma.teamRecruitmentPost.findFirst({ where: { id: postId, teamId } });
    if (!post) throw notFound();
    if (post.status === 'REMOVED') throw new AppError(409, 'FootyFinder removed this post. It cannot be changed.', 'RECRUITMENT_POST_REMOVED');
    return post;
  }

  async updatePost(actorId: string, teamId: string, postId: string, input: RecruitmentPostInput, now = new Date()) {
    await this.managedPost(actorId, teamId, postId);
    const row = await prisma.teamRecruitmentPost.update({ where: { id: postId }, data: this.postData(input), include: postInclude });
    return this.toPostView(row, actorId, null, now);
  }

  /** Renewing reopens a closed or expired post for another 30 days. */
  async renewPost(actorId: string, teamId: string, postId: string, now = new Date()) {
    await this.managedPost(actorId, teamId, postId);
    const row = await prisma.teamRecruitmentPost.update({
      where: { id: postId },
      data: { status: 'OPEN', closedAt: null, expiresAt: new Date(now.getTime() + RECRUITMENT_POST_DAYS * DAY_MS) },
      include: postInclude,
    });
    return this.toPostView(row, actorId, null, now);
  }

  async closePost(actorId: string, teamId: string, postId: string, now = new Date()) {
    await this.managedPost(actorId, teamId, postId);
    const row = await prisma.teamRecruitmentPost.update({ where: { id: postId }, data: { status: 'CLOSED', closedAt: now }, include: postInclude });
    return this.toPostView(row, actorId, null, now);
  }

  async myCard(viewerId: string): Promise<MyLookingCard> {
    const card = await prisma.playerLookingCard.findUnique({ where: { userId: viewerId } });
    return {
      enabled: Boolean(card?.enabled),
      positions: card?.positions ?? [],
      area: card?.area ?? null,
      days: card?.days ?? [],
      times: card?.times ?? [],
      note: card?.note ?? null,
      removedByFootyFinder: Boolean(card?.removedAt),
    };
  }

  async updateCard(viewerId: string, input: LookingCardInput): Promise<MyLookingCard> {
    const existing = await prisma.playerLookingCard.findUnique({ where: { userId: viewerId } });
    if (existing?.removedAt && input.enabled)
      throw new AppError(409, 'FootyFinder removed your "Looking for a team" card. Contact support if you think this was a mistake.', 'LOOKING_CARD_REMOVED');
    const data = { enabled: input.enabled, positions: input.positions, area: input.area ?? null, days: [...input.days].sort(), times: input.times, note: input.note ?? null };
    await prisma.playerLookingCard.upsert({ where: { userId: viewerId }, create: { userId: viewerId, ...data }, update: data });
    return this.myCard(viewerId);
  }

  /** "Players looking": cards that are on, from active players, hidden both ways across a block. */
  async listLooking(viewerId: string | null, query: RecruitmentQuery): Promise<LookingCardView[]> {
    const rows = await prisma.playerLookingCard.findMany({
      where: {
        enabled: true,
        removedAt: null,
        user: {
          accountStatus: 'ACTIVE',
          onboardingCompletedAt: { not: null },
          ...(query.q ? { profile: { displayName: { contains: query.q, mode: 'insensitive' } } } : {}),
        },
        ...(query.position ? { positions: { has: query.position } } : {}),
        ...(query.area ? { area: { contains: query.area, mode: 'insensitive' } } : {}),
      },
      include: { user: { select: socialCardSelect } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    const blocked = viewerId ? await blockedEitherWay(prisma, viewerId, rows.map(({ userId }) => userId)) : new Set<string>();
    const visible = rows.filter(({ userId }) => !blocked.has(userId));
    const relationships = viewerId
      ? await this.friends.relationships(viewerId, visible.map(({ userId }) => userId))
      : new Map(visible.map(({ userId }) => [userId, { userId, state: 'UNAVAILABLE' as const }]));
    return visible.map((row) => ({
      id: row.id,
      player: toSocialCard(row.user, relationships.get(row.userId)!),
      positions: row.positions,
      area: row.area,
      days: row.days,
      times: row.times,
      note: row.note,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  private joinRequestInclude = { team: { select: { id: true, name: true } }, user: { select: socialCardSelect } } as const;
  private async toRequestViews(viewerId: string, rows: Array<Prisma.TeamJoinRequestGetPayload<{ include: { team: { select: { id: true; name: true } }; user: { select: typeof socialCardSelect } } }>>) {
    const relationships = await this.friends.relationships(viewerId, rows.map(({ userId }) => userId));
    // CEO batch 5: requests from a player who is deleting their account are not shown.
    return rows.filter((row) => !isHiddenAccount(row.user.accountStatus)).map((row): TeamJoinRequestView => ({
      id: row.id,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      team: row.team,
      postId: row.postId,
      player: toSocialCard(row.user, relationships.get(row.userId)!),
    }));
  }

  /** "Ask to join" from a post; the team's Owner and Captains are told in the app. */
  async askToJoin(viewerId: string, postId: string, now = new Date()) {
    const result = await serializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${viewerId}::uuid FOR UPDATE`;
      const post = await tx.teamRecruitmentPost.findUnique({ where: { id: postId }, include: postInclude });
      if (!post || post.status !== 'OPEN' || post.expiresAt <= now || post.team.archivedAt) throw notFound();
      const managers = managersOf(post);
      if ((await blocksEitherWay(tx, viewerId, managers)).size) throw notFound();
      if (post.team.memberships.some(({ userId }) => userId === viewerId))
        throw new AppError(409, 'You are already in this team.', 'JOIN_REQUEST_ALREADY_MEMBER');
      await tx.teamJoinRequest.updateMany({ where: { teamId: post.teamId, userId: viewerId, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED', respondedAt: now } });
      const existing = await tx.teamJoinRequest.findFirst({ where: { teamId: post.teamId, userId: viewerId, status: 'PENDING' }, include: this.joinRequestInclude });
      if (existing) return { row: existing, notifications: [] };
      const pending = await tx.teamJoinRequest.count({ where: { userId: viewerId, status: 'PENDING', expiresAt: { gt: now } } });
      if (pending >= JOIN_REQUESTS_PENDING_MAX)
        throw new AppError(409, `You have ${JOIN_REQUESTS_PENDING_MAX} requests to join teams waiting for an answer. Wait for some to be answered or cancel some first.`, 'JOIN_REQUEST_PENDING_LIMIT');
      const row = await tx.teamJoinRequest.create({
        data: { teamId: post.teamId, postId, userId: viewerId, expiresAt: new Date(now.getTime() + JOIN_REQUEST_EXPIRY_DAYS * DAY_MS) },
        include: this.joinRequestInclude,
      });
      const name = row.user.profile?.displayName ?? row.user.username;
      const notifications = await persistNotifications(tx, managers.map((managerId) => ({
        userId: managerId,
        type: 'TEAM_JOIN_REQUEST_RECEIVED' as const,
        title: 'Request to join your team',
        message: `${name} asked to join ${post.team.name}.`,
        targetPath: `/teams/${post.teamId}?tab=invites`,
        dedupeKey: notificationDedupeKey('team-join-request', row.id, 'received', managerId),
      })));
      return { row, notifications };
    });
    this.notifications.publishPersistedMany(result.notifications);
    return (await this.toRequestViews(viewerId, [result.row]))[0]!;
  }

  async myJoinRequests(viewerId: string, now = new Date()) {
    const rows = await prisma.teamJoinRequest.findMany({
      where: { userId: viewerId, status: 'PENDING', expiresAt: { gt: now } },
      include: this.joinRequestInclude,
      orderBy: { createdAt: 'desc' },
    });
    return this.toRequestViews(viewerId, rows);
  }

  async cancelJoinRequest(viewerId: string, requestId: string, now = new Date()) {
    const updated = await prisma.teamJoinRequest.updateMany({ where: { id: requestId, userId: viewerId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: now } });
    if (updated.count !== 1) throw requestNotFound();
    return { requestId, status: 'CANCELLED' as const };
  }

  async teamJoinRequests(actorId: string, teamId: string, now = new Date()) {
    await this.assertManager(prisma, teamId, actorId);
    const rows = await prisma.teamJoinRequest.findMany({
      where: { teamId, status: 'PENDING', expiresAt: { gt: now } },
      include: this.joinRequestInclude,
      orderBy: { createdAt: 'asc' },
    });
    return this.toRequestViews(actorId, rows);
  }

  /** Accepting adds the player through the normal team membership path; either way they are told. */
  async respondJoinRequest(actorId: string, teamId: string, requestId: string, accept: boolean, now = new Date()) {
    const result = await serializableTransaction(async (tx) => {
      const team = await this.assertManager(tx, teamId, actorId);
      await tx.$queryRaw`SELECT "id" FROM "TeamJoinRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE`;
      const request = await tx.teamJoinRequest.findFirst({ where: { id: requestId, teamId } });
      if (!request) throw requestNotFound();
      if (request.status !== 'PENDING') throw new AppError(409, 'This request is no longer open.', 'JOIN_REQUEST_CLOSED');
      if (request.expiresAt <= now) {
        await tx.teamJoinRequest.update({ where: { id: request.id }, data: { status: 'EXPIRED', respondedAt: now } });
        throw new AppError(410, 'This request has expired.', 'JOIN_REQUEST_EXPIRED');
      }
      await tx.teamJoinRequest.update({ where: { id: request.id }, data: { status: accept ? 'ACCEPTED' : 'DECLINED', respondedAt: now, respondedById: actorId } });
      let joined: Awaited<ReturnType<typeof joinTeamAsMember>> | null = null;
      if (accept && !(await tx.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId: request.userId } } }))) {
        joined = await joinTeamAsMember(tx, teamId, request.userId, ['team-join-request', request.id]);
        // D13: joining a team switches the "Looking for a team" card off.
        await tx.playerLookingCard.updateMany({ where: { userId: request.userId, enabled: true }, data: { enabled: false } });
      }
      const answered = await persistNotifications(tx, [{
        userId: request.userId,
        type: 'TEAM_JOIN_REQUEST_ANSWERED',
        title: accept ? 'Welcome to the team' : 'Request to join declined',
        message: accept ? `${team.name} accepted your request. You're now a member.` : `${team.name} declined your request to join.`,
        targetPath: accept ? `/teams/${teamId}` : '/social?tab=teams',
        dedupeKey: notificationDedupeKey('team-join-request', request.id, 'answered'),
      }]);
      return { request, joined, notifications: [...(joined?.notifications ?? []), ...answered] };
    });
    this.notifications.publishPersistedMany(result.notifications);
    if (result.joined) emitDomainEventBestEffort('team:member-joined', { teamId, member: toTeamMember(result.joined.membership) });
    return { requestId, status: accept ? ('ACCEPTED' as const) : ('DECLINED' as const) };
  }

  /** Admin: reported (or all) posts and cards, with their open report counts. */
  async adminList(query: { kind?: 'POST' | 'CARD'; queue: 'reported' | 'all' }): Promise<AdminRecruitmentItem[]> {
    const reports = await prisma.moderationReport.groupBy({
      by: ['targetType', 'targetId'],
      where: { targetType: { in: ['RECRUITMENT_POST', 'LOOKING_CARD'] }, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
      _count: { _all: true },
    });
    const open = new Map(reports.map((row) => [`${row.targetType}:${row.targetId}`, row._count._all]));
    const reportedIds = (type: string) => reports.filter(({ targetType }) => targetType === type).map(({ targetId }) => targetId);
    const items: AdminRecruitmentItem[] = [];
    if (query.kind !== 'CARD') {
      const posts = await prisma.teamRecruitmentPost.findMany({
        where: query.queue === 'reported' ? { id: { in: reportedIds('RECRUITMENT_POST') } } : {},
        include: { team: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      items.push(...posts.map((post) => ({
        kind: 'POST' as const, id: post.id, title: `${post.team.name}: ${post.playersWanted} wanted (${post.format})`, ownerDisplayName: post.team.name,
        teamId: post.teamId, note: post.note, area: post.area, status: post.status, openReports: open.get(`RECRUITMENT_POST:${post.id}`) ?? 0,
        removedAt: post.removedAt?.toISOString() ?? null, removedReason: post.removedReason, createdAt: post.createdAt.toISOString(),
      })));
    }
    if (query.kind !== 'POST') {
      const cards = await prisma.playerLookingCard.findMany({
        where: query.queue === 'reported' ? { id: { in: reportedIds('LOOKING_CARD') } } : { enabled: true },
        include: { user: { select: { id: true, username: true, profile: { select: { displayName: true } } } } },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      });
      items.push(...cards.map((card) => ({
        kind: 'CARD' as const, id: card.id, title: `Looking for a team: ${card.user.profile?.displayName ?? card.user.username}`,
        ownerDisplayName: card.user.profile?.displayName ?? card.user.username, userId: card.userId, note: card.note, area: card.area,
        status: card.removedAt ? 'REMOVED' : card.enabled ? 'ON' : 'OFF', openReports: open.get(`LOOKING_CARD:${card.id}`) ?? 0,
        removedAt: card.removedAt?.toISOString() ?? null, removedReason: card.removedReason, createdAt: card.createdAt.toISOString(),
      })));
    }
    return items;
  }

  /** Admin removal (audited); open reports about it are resolved with the same reason. */
  async adminRemove(adminId: string, kind: 'POST' | 'CARD', id: string, reason: string, requestId: string, now = new Date()) {
    await serializableTransaction(async (tx) => {
      if (kind === 'POST') {
        const updated = await tx.teamRecruitmentPost.updateMany({ where: { id, status: { not: 'REMOVED' } }, data: { status: 'REMOVED', removedAt: now, removedById: adminId, removedReason: reason } });
        if (updated.count !== 1 && !(await tx.teamRecruitmentPost.findUnique({ where: { id } }))) throw notFound();
      } else {
        const updated = await tx.playerLookingCard.updateMany({ where: { id, removedAt: null }, data: { enabled: false, removedAt: now, removedById: adminId, removedReason: reason } });
        if (updated.count !== 1 && !(await tx.playerLookingCard.findUnique({ where: { id } })))
          throw new AppError(404, 'Looking card not found.', 'LOOKING_CARD_NOT_FOUND');
      }
      await tx.moderationReport.updateMany({
        where: { targetType: kind === 'POST' ? 'RECRUITMENT_POST' : 'LOOKING_CARD', targetId: id, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
        data: { status: 'RESOLVED', resolutionSummary: `Removed: ${reason}`, resolvedAt: now },
      });
      await appendAdminAudit(tx, {
        actorUserId: adminId, action: kind === 'POST' ? 'RECRUITMENT_POST_REMOVED' : 'LOOKING_CARD_REMOVED',
        entityType: kind === 'POST' ? 'RECRUITMENT_POST' : 'LOOKING_CARD', entityId: id, requestId, metadata: { reason },
      });
    });
    return { id, kind, removed: true };
  }
}
