import { prisma } from '../../database/prisma.js';
import { safeUserInclude } from '../users/users.repository.js';

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
      const message = await tx.directMessage.create({
        data: { conversationId, senderId, content },
        include: { sender: { include: safeUserInclude } },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      return message;
    });
  }
  markRead(conversationId: string, userId: string) {
    return prisma.conversationParticipant.updateMany({
      where: { conversationId, userId },
      data: { lastReadAt: new Date() },
    });
  }
}
