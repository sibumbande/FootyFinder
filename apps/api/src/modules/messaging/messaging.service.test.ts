import type { Notification } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { MessagingRepository } from './messaging.repository.js';
import { MessagingService } from './messaging.service.js';

const now = new Date('2026-08-23T00:00:00.000Z');
const sender = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'sender@example.invalid',
  username: 'sender',
  createdAt: now,
  updatedAt: now,
  profile: null,
  walletAccount: null,
  teamMemberships: [],
};
const notification: Notification = {
  id: '33333333-3333-4333-8333-333333333333',
  userId: '22222222-2222-4222-8222-222222222222',
  dedupeKey: 'direct-message:message-1:recipient:user-2',
  type: 'DIRECT_MESSAGE',
  title: 'Message from sender',
  message: 'Hello',
  targetPath: '/messages/conversation-1',
  readAt: null,
  createdAt: now,
};

describe('MessagingService notification publication', () => {
  it('publishes only the rows committed with the Direct Message', async () => {
    const messages = {
      send: vi.fn().mockResolvedValue({
        message: {
          id: 'message-1',
          conversationId: 'conversation-1',
          senderId: sender.id,
          content: 'Hello',
          createdAt: now,
          editedAt: null,
          deletedAt: null,
          sender,
        },
        recipientUserId: notification.userId,
        notifications: [notification],
      }),
    } as unknown as MessagingRepository;
    const notifications = {
      publishPersistedMany: vi.fn(),
    } as unknown as NotificationsService;

    await expect(
      new MessagingService(messages, notifications).send('conversation-1', sender.id, 'Hello'),
    ).resolves.toMatchObject({ id: 'message-1' });

    expect(notifications.publishPersistedMany).toHaveBeenCalledWith([notification]);
    expect(vi.mocked(messages.send).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(notifications.publishPersistedMany).mock.invocationCallOrder[0]!,
    );
  });

  it('does not publish when the message transaction rejects the sender', async () => {
    const messages = { send: vi.fn().mockResolvedValue(null) } as unknown as MessagingRepository;
    const notifications = {
      publishPersistedMany: vi.fn(),
    } as unknown as NotificationsService;

    await expect(
      new MessagingService(messages, notifications).send('conversation-1', sender.id, 'Hello'),
    ).rejects.toMatchObject({ code: 'CONVERSATION_REQUIRED' });
    expect(notifications.publishPersistedMany).not.toHaveBeenCalled();
  });
});
