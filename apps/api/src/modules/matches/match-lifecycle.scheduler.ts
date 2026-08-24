import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import {
  notificationDedupeKey,
  persistNotifications,
} from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { logError } from '../../observability/logger.js';
import { incrementOperationalMetric } from '../../observability/operational-metrics.js';

const POLL_INTERVAL_MS = 15_000;

export async function runMatchLifecycleTick(
  now = new Date(),
  notifications = new NotificationsService(),
) {
  const starting = await prisma.match.findMany({
    where: {
      mode: 'QUICK_GAME',
      status: { in: ['OPEN', 'READY', 'FULL'] },
      startsAt: { lte: now },
    },
    select: { id: true },
  });

  for (const candidate of starting) {
    await transitionMatchToStarted(candidate.id, notifications);
  }

  const inProgress = await prisma.match.findMany({
    where: { mode: 'QUICK_GAME', status: 'IN_PROGRESS' },
    select: { id: true, startsAt: true, durationMinutes: true },
  });
  for (const match of inProgress) {
    const endsAt = match.startsAt.getTime() + match.durationMinutes * 60_000;
    if (endsAt > now.getTime()) continue;
    const transition = await prisma.match.updateMany({
      where: { id: match.id, status: 'IN_PROGRESS' },
      data: { status: 'AWAITING_RESULT' },
    });
    if (transition.count === 1) {
      incrementOperationalMetric('match_lifecycle_ended_total');
      emitDomainEventBestEffort('match:ended', { matchId: match.id });
    }
  }
}

export async function transitionMatchToStarted(
  matchId: string,
  notifications = new NotificationsService(),
) {
  const result = await serializableTransaction(async (tx) => {
    const transition = await tx.match.updateMany({
      where: { id: matchId, status: { in: ['OPEN', 'READY', 'FULL'] } },
      data: { status: 'IN_PROGRESS' },
    });
    if (transition.count !== 1) return null;
    const match = await tx.match.findUniqueOrThrow({
      where: { id: matchId },
      select: {
        id: true,
        name: true,
        createdById: true,
        participants: { where: { status: 'JOINED' }, select: { userId: true } },
      },
    });
    const recipients = new Set([
      match.createdById,
      ...match.participants.map(({ userId }) => userId),
    ]);
    return {
      matchId: match.id,
      notifications: await persistNotifications(
        tx,
        [...recipients].map((userId) => ({
          userId,
          type: 'MATCH_STARTED' as const,
          title: 'Kick-off',
          message: `${match.name} has started.`,
          targetPath: `/matches/${match.id}`,
          dedupeKey: notificationDedupeKey('match', match.id, 'started', userId),
        })),
      ),
    };
  });
  if (!result) return false;
  incrementOperationalMetric('match_lifecycle_started_total');
  emitDomainEventBestEffort('match:started', { matchId: result.matchId });
  notifications.publishPersistedMany(result.notifications);
  return true;
}

export function startMatchLifecycleScheduler(notifications = new NotificationsService()) {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runMatchLifecycleTick(new Date(), notifications);
      incrementOperationalMetric('match_lifecycle_ticks_total');
    } catch (error) {
      incrementOperationalMetric('match_lifecycle_scheduler_failures_total');
      logError('match_lifecycle_scheduler_failed', error);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
