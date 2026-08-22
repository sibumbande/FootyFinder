import { prisma } from '../../database/prisma.js';
import { domainEvents } from '../../events/domain-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const POLL_INTERVAL_MS = 15_000;

const recipientsFor = (match: { createdById: string; participants: Array<{ userId: string }> }) => [
  ...new Set([match.createdById, ...match.participants.map(({ userId }) => userId)]),
];

export function startMatchLifecycleScheduler(notifications = new NotificationsService()) {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const starting = await prisma.match.findMany({
        where: {
          mode: 'QUICK_GAME',
          status: { in: ['OPEN', 'READY', 'FULL'] },
          startsAt: { lte: now },
        },
        select: {
          id: true,
          name: true,
          createdById: true,
          participants: { where: { status: 'JOINED' }, select: { userId: true } },
        },
      });

      for (const match of starting) {
        const transition = await prisma.match.updateMany({
          where: { id: match.id, status: { in: ['OPEN', 'READY', 'FULL'] } },
          data: { status: 'IN_PROGRESS' },
        });
        if (transition.count !== 1) continue;
        domainEvents.emit('match:started', { matchId: match.id });
        await Promise.all(
          recipientsFor(match).map((userId) =>
            notifications.create(
              userId,
              'MATCH_STARTED',
              'Kick-off',
              `${match.name} has started.`,
              `/matches/${match.id}`,
            ),
          ),
        );
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
        if (transition.count === 1) domainEvents.emit('match:ended', { matchId: match.id });
      }
    } catch (error) {
      console.error('Match lifecycle scheduler failed:', error);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
