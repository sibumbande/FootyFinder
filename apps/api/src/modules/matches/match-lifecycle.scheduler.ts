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
import { createVenuePayableForStartedMatch } from '../settlement/venue-payables.js';
import { recordKickoffLineup } from './lineup-record.js';
import { enqueueResultOverdueJob } from '../referees/referee-results.js';
import { hostAudience } from './host.js';

const POLL_INTERVAL_MS = 15_000;

/**
 * DEC-018: a match under the go/no-go rule (goNoGoAt set) may start only once it has been
 * confirmed. Legacy matches (goNoGoAt NULL) keep starting as before. An unconfirmed match past
 * kickoff means its go/no-go job has not run yet; it is left for the durable queue.
 */
const STARTABLE = { OR: [{ goNoGoAt: null }, { confirmedAt: { not: null } }] };

export async function runMatchLifecycleTick(
  now = new Date(),
  notifications = new NotificationsService(),
) {
  const starting = await prisma.match.findMany({
    where: {
      // Gate 7: DEC-019 team matches start (and owe their venue) exactly like Quick Matches.
      AND: [{ OR: [{ mode: 'QUICK_GAME' }, { mode: 'TEAM_MATCH', otherSideMode: { not: null } }] }, STARTABLE],
      status: { in: ['OPEN', 'READY'] },
      startsAt: { lte: now },
    },
    select: { id: true },
  });

  for (const candidate of starting) {
    await transitionMatchToStarted(candidate.id, notifications);
  }

  const inProgress = await prisma.match.findMany({
    where: { OR: [{ mode: 'QUICK_GAME' }, { mode: 'TEAM_MATCH', otherSideMode: { not: null } }], status: 'IN_PROGRESS' },
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
      where: { id: matchId, status: { in: ['OPEN', 'READY'] }, ...STARTABLE },
      data: { status: 'IN_PROGRESS' },
    });
    if (transition.count !== 1) return null;
    // Gate 6 / TKT-607: kickoff is when a confirmed match has gone ahead and its venue is owed.
    await createVenuePayableForStartedMatch(tx, matchId);
    // Gate 8 / TKT-803: the permanent lineup record the referee, stats and reviews use.
    await recordKickoffLineup(tx, matchId);
    // D4: admins are alerted if a refereed match has no result two hours after its scheduled end.
    const timing = await tx.match.findUniqueOrThrow({ where: { id: matchId }, select: { id: true, startsAt: true, durationMinutes: true, goNoGoAt: true } });
    if (timing.goNoGoAt) await enqueueResultOverdueJob(tx, timing);
    const match = await tx.match.findUniqueOrThrow({
      where: { id: matchId },
      select: {
        id: true,
        name: true,
        createdById: true,
        hostedByFootyFinder: true,
        participants: { where: { status: 'JOINED' }, select: { userId: true } },
        teamSides: { select: { team: { select: { memberships: { select: { userId: true } } } } } },
      },
    });
    const recipients = new Set([
      ...hostAudience(match),
      ...match.participants.map(({ userId }) => userId),
      ...match.teamSides.flatMap(({ team }) => team?.memberships.map(({ userId }) => userId) ?? []),
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
