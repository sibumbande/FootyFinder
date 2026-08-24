import type { Notification, Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { persistNotifications, type NotificationDraft } from './notification-writer.js';

const draft = (dedupeKey: string, title = dedupeKey): NotificationDraft => ({
  userId: '11111111-1111-4111-8111-111111111111',
  type: 'INFO',
  title,
  message: 'Message',
  targetPath: '/',
  dedupeKey,
});

const transaction = () => {
  const createManyAndReturn = vi.fn().mockImplementation(({ data }) =>
    data.map((item: NotificationDraft, index: number) => ({
      ...item,
      id: `notification-${index}`,
      targetPath: item.targetPath ?? null,
      readAt: null,
      createdAt: new Date('2026-08-23T00:00:00.000Z'),
    })),
  );
  return {
    tx: { notification: { createManyAndReturn } } as unknown as Prisma.TransactionClient,
    createManyAndReturn,
  };
};

describe('persistNotifications', () => {
  it('keeps the first deterministic draft for duplicate keys', async () => {
    const { tx, createManyAndReturn } = transaction();

    const created = await persistNotifications(tx, [draft('same', 'First'), draft('same', 'Last')]);

    expect(created).toHaveLength(1);
    expect(createManyAndReturn).toHaveBeenCalledWith({
      data: [draft('same', 'First')],
      skipDuplicates: true,
    });
  });

  it('writes large recipient sets in bounded batches', async () => {
    const { tx, createManyAndReturn } = transaction();
    const drafts = Array.from({ length: 501 }, (_, index) => draft(`notification-${index}`));

    const created = (await persistNotifications(tx, drafts)) as Notification[];

    expect(created).toHaveLength(501);
    expect(createManyAndReturn).toHaveBeenCalledTimes(2);
    expect(createManyAndReturn.mock.calls[0]?.[0].data).toHaveLength(500);
    expect(createManyAndReturn.mock.calls[1]?.[0].data).toHaveLength(1);
  });
});
