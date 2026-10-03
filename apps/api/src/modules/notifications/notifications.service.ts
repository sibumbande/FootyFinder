import type { AppNotification } from '@footy-finder/shared';
import type { Notification } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import { NotificationsRepository } from './notifications.repository.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';

export const mapNotification = (item: Notification): AppNotification => ({
  id: item.id,
  type: item.type,
  title: item.title,
  message: item.message,
  targetPath: item.targetPath,
  createdAt: item.createdAt.toISOString(),
  readAt: item.readAt?.toISOString(),
});
export class NotificationsService {
  constructor(private readonly notifications = new NotificationsRepository()) {}
  publishPersisted(item: Notification) {
    const notification = mapNotification(item);
    emitDomainEventBestEffort('notification:created', { userId: item.userId, notification });
    return notification;
  }
  publishPersistedMany(items: Notification[]) {
    return items.map((item) => this.publishPersisted(item));
  }
  async list(userId: string) {
    return (await this.notifications.list(userId)).map(mapNotification);
  }
  async markRead(id: string, userId: string) {
    if ((await this.notifications.markRead(id, userId)).count !== 1)
      throw new AppError(404, 'Notification not found.', 'NOTIFICATION_NOT_FOUND');
  }
  async markAllRead(userId: string) {
    await this.notifications.markAllRead(userId);
  }
}
