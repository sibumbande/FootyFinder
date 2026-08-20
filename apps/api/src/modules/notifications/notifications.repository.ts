import type { NotificationType } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';

export class NotificationsRepository {
  create(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    targetPath?: string,
  ) {
    return prisma.notification.create({ data: { userId, type, title, message, targetPath } });
  }
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
