import {
  TEAM_MEMBER_INVITE_EXPIRY_DAYS,
  type InvitableFriend,
  type TeamMemberInviteSource,
  type TeamMemberInviteView,
} from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { joinTeamAsMember } from '../teams/teams.repository.js';
import { toTeamMember } from '../teams/team.mapper.js';
import { onBlock } from './blocks.service.js';
import { orderedPair } from './friend-rules.js';
import { FriendsService, socialCardSelect, toSocialCard } from './friends.service.js';
import { isHiddenAccount } from '../users/hidden-account.js';
import { blockedEitherWay, isBlockedEitherWay } from './visibility.js';

type Db = Prisma.TransactionClient;
const DAY_MS = 86_400_000;

const inviteInclude = {
  team: { select: { id: true, name: true, profileImageUrl: true, archivedAt: true } },
  invitedBy: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
  invitee: { select: socialCardSelect },
} satisfies Prisma.TeamMemberInviteInclude;
type InviteRow = Prisma.TeamMemberInviteGetPayload<{ include: typeof inviteInclude }>;

const toView = (row: InviteRow, relationshipState: TeamMemberInviteView['invitee']['relationship']): TeamMemberInviteView => ({
  id: row.id,
  status: row.status,
  source: row.source,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  team: { id: row.team.id, name: row.team.name, profileImageUrl: row.team.profileImageUrl },
  invitedBy: { id: row.invitedBy.id, username: row.invitedBy.username, displayName: row.invitedBy.profile?.displayName ?? row.invitedBy.username },
  invitee: toSocialCard(row.invitee, relationshipState),
});

const notFound = () => new AppError(404, 'Team invite not found.', 'TEAM_INVITE_NOT_FOUND');
const notEligible = () => new AppError(403, "You can't invite this player to your team.", 'TEAM_INVITE_NOT_ELIGIBLE');

/** A block between two players cancels the personal invites between them (TKT-903 / D9). */
onBlock((tx, a, b, now) =>
  tx.teamMemberInvite.updateMany({
    where: { status: 'PENDING', OR: [{ inviteeId: a, invitedById: b }, { inviteeId: b, invitedById: a }] },
    data: { status: 'CANCELLED', respondedAt: now },
  }));

/**
 * Gate 9 / TKT-904 (D11): the Owner or a Captain invites one player to the Team, in one tap. The
 * player accepts (joining through the normal membership path) or declines. Link invites stay.
 */
export class TeamMemberInvitesService {
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
    if (!team.memberships.some(({ role }) => role === 'OWNER' || role === 'CAPTAIN'))
      throw new AppError(403, 'Only the team owner or a captain can invite players.', 'TEAM_FORBIDDEN');
    return team;
  }

  /** Who may be invited: a friend of the inviter, or (TKT-909) a player whose looking card is on. */
  private async eligible(db: Db, actorId: string, inviteeId: string, source: TeamMemberInviteSource) {
    if (source === 'FRIEND') return Boolean(await db.friendship.findUnique({ where: { userLowId_userHighId: orderedPair(actorId, inviteeId) } }));
    return Boolean(await db.playerLookingCard.findFirst({ where: { userId: inviteeId, enabled: true, removedAt: null } }));
  }

  async invite(actorId: string, teamId: string, inviteeId: string, source: TeamMemberInviteSource = 'FRIEND', now = new Date()) {
    if (actorId === inviteeId) throw new AppError(400, "You can't invite yourself.", 'TEAM_INVITE_SELF');
    const result = await serializableTransaction(async (tx) => {
      const team = await this.assertManager(tx, teamId, actorId);
      const invitee = await tx.user.findUnique({ where: { id: inviteeId }, select: { id: true, accountStatus: true, onboardingCompletedAt: true } });
      if (!invitee || invitee.accountStatus !== 'ACTIVE' || !invitee.onboardingCompletedAt) throw notEligible();
      if (await isBlockedEitherWay(tx, actorId, inviteeId)) throw notEligible();
      if (!(await this.eligible(tx, actorId, inviteeId, source))) throw notEligible();
      if (await tx.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId: inviteeId } } }))
        throw new AppError(409, 'This player is already in your team.', 'TEAM_INVITE_ALREADY_MEMBER');
      await tx.teamMemberInvite.updateMany({ where: { teamId, inviteeId, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED', respondedAt: now } });
      const existing = await tx.teamMemberInvite.findFirst({ where: { teamId, inviteeId, status: 'PENDING' }, include: inviteInclude });
      if (existing) return { row: existing, notifications: [] };
      const row = await tx.teamMemberInvite.create({
        data: { teamId, inviteeId, invitedById: actorId, source, expiresAt: new Date(now.getTime() + TEAM_MEMBER_INVITE_EXPIRY_DAYS * DAY_MS) },
        include: inviteInclude,
      });
      const inviterName = row.invitedBy.profile?.displayName ?? row.invitedBy.username;
      const notifications = await persistNotifications(tx, [{
        userId: inviteeId,
        type: 'TEAM_INVITE_RECEIVED',
        title: 'Team invite',
        message: `${inviterName} invited you to join ${team.name}.`,
        targetPath: '/social?tab=friends',
        dedupeKey: notificationDedupeKey('team-member-invite', row.id, 'received'),
      }]);
      return { row, notifications };
    });
    this.notifications.publishPersistedMany(result.notifications);
    return toView(result.row, (await this.friends.relationships(actorId, [inviteeId])).get(inviteeId)!);
  }

  /** The Team's pending invites (Owner and Captains). */
  async forTeam(actorId: string, teamId: string, now = new Date()) {
    await this.assertManager(prisma, teamId, actorId);
    const rows = await prisma.teamMemberInvite.findMany({ where: { teamId, status: 'PENDING', expiresAt: { gt: now } }, include: inviteInclude, orderBy: { createdAt: 'desc' } });
    const relationships = await this.friends.relationships(actorId, rows.map(({ inviteeId }) => inviteeId));
    return rows.filter((row) => !isHiddenAccount(row.invitee.accountStatus)).map((row) => toView(row, relationships.get(row.inviteeId)!));
  }

  /** The friend picker: your friends, marked as members, invited, or invitable. */
  async invitableFriends(actorId: string, teamId: string, now = new Date()): Promise<InvitableFriend[]> {
    await this.assertManager(prisma, teamId, actorId);
    const [friends, members, pending] = await Promise.all([
      this.friends.friends(actorId),
      prisma.teamMembership.findMany({ where: { teamId }, select: { userId: true } }),
      prisma.teamMemberInvite.findMany({ where: { teamId, status: 'PENDING', expiresAt: { gt: now } }, select: { id: true, inviteeId: true } }),
    ]);
    const memberIds = new Set(members.map(({ userId }) => userId));
    return friends.map((player) => {
      const invite = pending.find(({ inviteeId }) => inviteeId === player.id);
      return memberIds.has(player.id)
        ? { player, status: 'MEMBER' as const }
        : invite
          ? { player, status: 'INVITED' as const, inviteId: invite.id }
          : { player, status: 'INVITABLE' as const };
    });
  }

  /** Invites waiting for you (shown in the Friends tab). */
  async mine(viewerId: string, now = new Date()) {
    const rows = await prisma.teamMemberInvite.findMany({
      where: { inviteeId: viewerId, status: 'PENDING', expiresAt: { gt: now }, team: { archivedAt: null } },
      include: inviteInclude,
      orderBy: { createdAt: 'desc' },
    });
    const blocked = await blockedEitherWay(prisma, viewerId, rows.map(({ invitedById }) => invitedById));
    return rows.filter(({ invitedById }) => !blocked.has(invitedById)).map((row) => toView(row, { userId: viewerId, state: 'SELF' }));
  }

  async respond(viewerId: string, inviteId: string, accept: boolean, now = new Date()) {
    const result = await serializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "TeamMemberInvite" WHERE "id" = ${inviteId}::uuid FOR UPDATE`;
      const row = await tx.teamMemberInvite.findUnique({ where: { id: inviteId }, include: inviteInclude });
      if (!row || row.inviteeId !== viewerId) throw notFound();
      if (row.status !== 'PENDING') throw new AppError(409, 'This invite is no longer open.', 'TEAM_INVITE_CLOSED');
      if (row.expiresAt <= now) {
        await tx.teamMemberInvite.update({ where: { id: row.id }, data: { status: 'EXPIRED', respondedAt: now } });
        throw new AppError(410, 'This invite has expired.', 'TEAM_INVITE_EXPIRED');
      }
      if (row.team.archivedAt) throw new AppError(409, 'This team has been closed.', 'TEAM_ARCHIVED');
      if (accept && (await isBlockedEitherWay(tx, viewerId, row.invitedById))) throw notFound();
      await tx.teamMemberInvite.update({ where: { id: row.id }, data: { status: accept ? 'ACCEPTED' : 'DECLINED', respondedAt: now } });
      let joined: Awaited<ReturnType<typeof joinTeamAsMember>> | null = null;
      if (accept && !(await tx.teamMembership.findUnique({ where: { teamId_userId: { teamId: row.teamId, userId: viewerId } } })))
        joined = await joinTeamAsMember(tx, row.teamId, viewerId, ['team-member-invite', row.id]);
      // D13: joining a team switches the player's "Looking for a team" card off.
      if (accept) await tx.playerLookingCard.updateMany({ where: { userId: viewerId, enabled: true }, data: { enabled: false } });
      const inviteeName = row.invitee.profile?.displayName ?? row.invitee.username;
      const answered = await persistNotifications(tx, [{
        userId: row.invitedById,
        type: 'TEAM_INVITE_ANSWERED',
        title: accept ? 'Team invite accepted' : 'Team invite declined',
        message: accept ? `${inviteeName} joined ${row.team.name}.` : `${inviteeName} declined your invite to ${row.team.name}.`,
        targetPath: `/teams/${row.teamId}`,
        dedupeKey: notificationDedupeKey('team-member-invite', row.id, 'answered'),
      }]);
      return { row, joined, notifications: [...(joined?.notifications ?? []), ...answered] };
    });
    this.notifications.publishPersistedMany(result.notifications);
    if (result.joined)
      emitDomainEventBestEffort('team:member-joined', { teamId: result.row.teamId, member: toTeamMember(result.joined.membership) });
    return { inviteId, status: accept ? ('ACCEPTED' as const) : ('DECLINED' as const), teamId: result.row.teamId };
  }

  async cancel(actorId: string, teamId: string, inviteId: string, now = new Date()) {
    await this.assertManager(prisma, teamId, actorId);
    const updated = await prisma.teamMemberInvite.updateMany({ where: { id: inviteId, teamId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: now } });
    if (updated.count !== 1) throw notFound();
    return { inviteId, status: 'CANCELLED' as const };
  }
}
