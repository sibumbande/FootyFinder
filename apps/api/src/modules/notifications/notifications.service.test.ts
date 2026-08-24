import type { Notification } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { domainEvents } from '../../events/domain-events.js';
import { mapNotification, NotificationsService } from './notifications.service.js';

const notification: Notification = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  dedupeKey: 'private:dedupe:key',
  type: 'INFO',
  title: 'Update',
  message: 'Something changed.',
  targetPath: '/',
  readAt: null,
  createdAt: new Date('2026-08-23T00:00:00.000Z'),
};

afterEach(() => {
  domainEvents.removeAllListeners('notification:created');
  vi.restoreAllMocks();
});

describe('NotificationsService publication', () => {
  it('does not expose internal deduplication keys in the public DTO', () => {
    expect(mapNotification(notification)).not.toHaveProperty('dedupeKey');
  });

  it('does not fail a committed operation when a publication listener throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    domainEvents.once('notification:created', () => {
      throw new Error('Socket unavailable');
    });

    expect(() => new NotificationsService().publishPersisted(notification)).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });
});
