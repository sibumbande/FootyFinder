import { prisma } from '../../database/prisma.js';

export class NotificationsRepository {
  list(userId: string) {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  markRead(id: string, userId: string) {
    return prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
  }
  markAllRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
