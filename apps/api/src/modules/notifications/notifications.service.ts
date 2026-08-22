import type { AppNotification, NotificationType } from '@footy-finder/shared';
import type { Notification } from '@prisma/client';
import { AppError } from '../../errors/app-error.js';
import { NotificationsRepository } from './notifications.repository.js';
import { domainEvents } from '../../events/domain-events.js';

export const mapNotification = (item: Notification): AppNotification => ({
  ...item,
  createdAt: item.createdAt.toISOString(),
  readAt: item.readAt?.toISOString(),
});
export class NotificationsService {
  constructor(private readonly notifications = new NotificationsRepository()) {}
  async create(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    targetPath?: string,
  ) {
    return this.publishPersisted(
      await this.notifications.create(userId, type, title, message, targetPath),
    );
  }
  publishPersisted(item: Notification) {
    const notification = mapNotification(item);
    domainEvents.emit('notification:created', { userId: item.userId, notification });
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
