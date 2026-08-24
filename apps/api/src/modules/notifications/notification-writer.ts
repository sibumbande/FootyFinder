import { type Notification, type NotificationType, Prisma } from '@prisma/client';

export interface NotificationDraft {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  targetPath?: string;
  dedupeKey: string;
}

const NOTIFICATION_BATCH_SIZE = 500;

export async function persistNotifications(
  tx: Prisma.TransactionClient,
  drafts: readonly NotificationDraft[],
): Promise<Notification[]> {
  const seen = new Set<string>();
  const uniqueDrafts = drafts.filter((draft) => {
    if (seen.has(draft.dedupeKey)) return false;
    seen.add(draft.dedupeKey);
    return true;
  });
  const created: Notification[] = [];
  for (let offset = 0; offset < uniqueDrafts.length; offset += NOTIFICATION_BATCH_SIZE) {
    created.push(
      ...(await tx.notification.createManyAndReturn({
        data: uniqueDrafts.slice(offset, offset + NOTIFICATION_BATCH_SIZE),
        skipDuplicates: true,
      })),
    );
  }
  return created;
}

export const notificationDedupeKey = (...parts: Array<string | number>) =>
  parts.map(String).join(':');
