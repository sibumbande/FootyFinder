import type { TeamChatMessage, TeamChatPage, TeamChatQuery } from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { toPublicUser } from '../users/user.mapper.js';
import { safeUserInclude } from '../users/users.repository.js';

const messageInclude = { sender: { include: safeUserInclude } } satisfies Prisma.TeamMessageInclude;
type MessageRecord = Prisma.TeamMessageGetPayload<{ include: typeof messageInclude }>;

export const toTeamChatMessage = (message: MessageRecord): TeamChatMessage => ({
  id: message.id,
  teamId: message.teamId,
  senderId: message.senderId,
  content: message.content,
  createdAt: message.createdAt.toISOString(),
  sender: toPublicUser(message.sender),
});

const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
const decodeCursor = (cursor: string) => {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || Number.isNaN(createdAt.getTime()))
    throw new AppError(400, 'That chat cursor is not valid.', 'TEAM_CHAT_CURSOR_INVALID');
  return { createdAt, id };
};

/**
 * Gate 7 / TKT-710 (section 3A "Team chat"): one permanent team-owned conversation with retained
 * history. Only current members may read or send; membership is checked on every request, so a
 * removed member loses access at once. A closed team's history stays readable to its members but
 * nobody can post. Chat never sends email.
 *
 * TKT-711: each other member gets ONE in-app "new messages" notice per read cycle (the first
 * message after they last read the chat); further messages add nothing until they read it again.
 * The sender never gets one. It is persisted with the message and published after commit.
 */
export class TeamChatService {
  constructor(private readonly notifications = new NotificationsService()) {}

  async history(teamId: string, userId: string, query: TeamChatQuery): Promise<TeamChatPage> {
    await this.assertMember(teamId, userId);
    const before = query.before ? decodeCursor(query.before) : null;
    const rows = await prisma.teamMessage.findMany({
      where: {
        teamId,
        ...(before && { OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }] }),
      },
      include: messageInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const oldest = page.at(-1);
    return {
      messages: page.reverse().map(toTeamChatMessage),
      olderCursor: rows.length > query.limit && oldest ? encodeCursor(oldest.createdAt, oldest.id) : null,
      unreadCount: await this.unreadCount(teamId, userId),
    };
  }

  async send(teamId: string, userId: string, content: string) {
    const team = await this.assertMember(teamId, userId);
    if (team.archivedAt) throw new AppError(409, 'This team has been closed, so its chat is read-only.', 'TEAM_ARCHIVED');
    const { record, notices } = await prisma.$transaction(async (tx) => {
      const record = await tx.teamMessage.create({ data: { teamId, senderId: userId, content }, include: messageInclude });
      const members = await tx.teamMembership.findMany({ where: { teamId, userId: { not: userId } }, select: { userId: true, joinedAt: true } });
      const readStates = await tx.teamChatReadState.findMany({ where: { teamId }, select: { userId: true, lastReadAt: true } });
      const details = await tx.team.findUniqueOrThrow({ where: { id: teamId }, select: { name: true } });
      const lastRead = new Map(readStates.map((state) => [state.userId, state.lastReadAt]));
      const senderName = record.sender.profile?.displayName ?? record.sender.username;
      const notices = await persistNotifications(tx, members.map((member) => ({
        userId: member.userId,
        type: 'TEAM_CHAT_UNREAD' as const,
        title: `New messages in ${details.name}`,
        message: `${senderName} posted in your team chat.`,
        targetPath: `/teams/${teamId}?tab=chat`,
        // One notice per member per read cycle: the key changes only when they read the chat.
        dedupeKey: notificationDedupeKey('team-chat', teamId, 'unread', member.userId, (lastRead.get(member.userId) ?? member.joinedAt).toISOString()),
      })));
      return { record, notices };
    });
    const message = toTeamChatMessage(record);
    emitDomainEventBestEffort('team-chat:message-created', { teamId, message });
    this.notifications.publishPersistedMany(notices);
    return message;
  }

  /** Marks the chat read up to now for this member (clears their unread count). */
  async markRead(teamId: string, userId: string, now = new Date()) {
    await this.assertMember(teamId, userId);
    await prisma.$transaction([
      prisma.teamChatReadState.upsert({
        where: { teamId_userId: { teamId, userId } },
        create: { teamId, userId, lastReadAt: now },
        update: { lastReadAt: now },
      }),
      prisma.notification.updateMany({
        where: { userId, type: 'TEAM_CHAT_UNREAD', targetPath: `/teams/${teamId}?tab=chat`, readAt: null },
        data: { readAt: now },
      }),
    ]);
    emitDomainEventBestEffort('team-chat:read', { teamId, userId });
    return { unreadCount: 0 };
  }

  async unreadCount(teamId: string, userId: string) {
    const state = await prisma.teamChatReadState.findUnique({ where: { teamId_userId: { teamId, userId } } });
    const membership = await prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId } }, select: { joinedAt: true } });
    // A new member's unread count starts when they joined, not at the start of the history.
    const since = state?.lastReadAt ?? membership?.joinedAt ?? new Date(0);
    return prisma.teamMessage.count({ where: { teamId, senderId: { not: userId }, createdAt: { gt: since } } });
  }

  private async assertMember(teamId: string, userId: string) {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { archivedAt: true, memberships: { where: { userId }, select: { id: true } } },
    });
    if (!team) throw new AppError(404, 'Team not found.', 'TEAM_NOT_FOUND');
    if (!team.memberships.length) throw new AppError(403, 'Only current team members can use the team chat.', 'TEAM_FORBIDDEN');
    return team;
  }
}
