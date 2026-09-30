import { prisma } from '../../database/prisma.js';
import {
  notificationDedupeKey,
  persistNotifications,
} from '../notifications/notification-writer.js';
import { safeUserInclude } from '../users/users.repository.js';
import { isBlockedEitherWay } from '../social/visibility.js';

const conversationInclude = {
  participants: { include: { user: { include: safeUserInclude } } },
  messages: {
    include: { sender: { include: safeUserInclude } },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
} as const;
export class MessagingRepository {
  userExists(userId: string) {
    return prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  }
  start(userId: string, otherUserId: string) {
    const directKey = [userId, otherUserId].sort().join(':');
    return prisma.conversation.upsert({
      where: { directKey },
      create: { directKey, participants: { create: [{ userId }, { userId: otherUserId }] } },
      update: {},
      include: conversationInclude,
    });
  }
  list(userId: string) {
    return prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      include: conversationInclude,
      orderBy: { updatedAt: 'desc' },
    });
  }
  find(id: string, userId: string) {
    return prisma.conversation.findFirst({
      where: { id, participants: { some: { userId } } },
      include: {
        participants: { include: { user: { include: safeUserInclude } } },
        messages: {
          include: { sender: { include: safeUserInclude } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }
  async send(conversationId: string, senderId: string, content: string) {
    return prisma.$transaction(async (tx) => {
      const membership = await tx.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId, userId: senderId } },
      });
      if (!membership) return null;
      const recipient = await tx.conversationParticipant.findFirst({
        where: { conversationId, userId: { not: senderId } },
        select: { userId: true },
      });
      // Gate 9 / TKT-903: no new direct messages either way once either player blocked the other.
      if (recipient && (await isBlockedEitherWay(tx, senderId, recipient.userId))) return { blocked: true as const };
      const message = await tx.directMessage.create({
        data: { conversationId, senderId, content },
        include: { sender: { include: safeUserInclude } },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      const notifications = recipient
        ? await persistNotifications(tx, [
            {
              userId: recipient.userId,
              type: 'DIRECT_MESSAGE',
              title: `Message from ${message.sender.profile?.displayName ?? message.sender.username}`,
              message: content.slice(0, 120),
              targetPath: `/messages/${conversationId}`,
              dedupeKey: notificationDedupeKey(
                'direct-message',
                message.id,
                'recipient',
                recipient.userId,
              ),
            },
          ])
        : [];
      return { message, recipientUserId: recipient?.userId, notifications };
    });
  }
  markRead(conversationId: string, userId: string) {
    return prisma.conversationParticipant.updateMany({
      where: { conversationId, userId },
      data: { lastReadAt: new Date() },
    });
  }
}
