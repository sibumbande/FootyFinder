import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import type { Notification } from '../../generated/prisma/client.js';
import { enqueueDurableJob, registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { createEmailProvider, type EmailProvider } from '../auth/email.provider.js';
import { formatKickoffTime, formatMatchDate } from '../matches/cancellation-message.js';
import { persistNotifications, notificationDedupeKey, type NotificationDraft } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  REFEREE_EMAIL_JOB_TYPE,
  REFEREE_NOTICE_JOB_TYPE,
  REFEREE_UNASSIGNED_ALERT_JOB_TYPE,
  hasActiveReferee,
} from './referee-assignment.js';

/**
 * Gate 8 / TKT-802 jobs (D19): the referee hears about being assigned or removed (in-app and
 * email); every active admin is alerted (in-app and email) when a match has no referee.
 */
export type RefereeEmailKind = 'REFEREE_ASSIGNED' | 'REFEREE_REMOVED' | 'ADMIN_REFEREE_UNASSIGNED';
const EMAIL_KINDS: readonly RefereeEmailKind[] = ['REFEREE_ASSIGNED', 'REFEREE_REMOVED', 'ADMIN_REFEREE_UNASSIGNED'];

type MessageMatch = { name: string; startsAt: Date; venueName: string };
const when = (startsAt: Date) => `${formatMatchDate(startsAt)} at ${formatKickoffTime(startsAt)}`;

/** Shared wording for the in-app notice and the email. */
export const refereeMessage = (kind: RefereeEmailKind, match: MessageMatch) => {
  switch (kind) {
    case 'REFEREE_ASSIGNED':
      return `You're the FootyFinder referee for ${match.name} at ${match.venueName} on ${when(match.startsAt)}. Open the Referee tab to see the match and its lineups.`;
    case 'REFEREE_REMOVED':
      return `You're no longer the referee for ${match.name} at ${match.venueName} on ${when(match.startsAt)}.`;
    case 'ADMIN_REFEREE_UNASSIGNED':
      return `${match.name} at ${match.venueName} on ${when(match.startsAt)} has no referee. Assign one in the admin dashboard, or the match is cancelled 30 minutes before kickoff.`;
  }
};

export const REFEREE_EMAIL_SUBJECT: Record<RefereeEmailKind, string> = {
  REFEREE_ASSIGNED: 'You have a match to referee',
  REFEREE_REMOVED: 'You are no longer refereeing a match',
  ADMIN_REFEREE_UNASSIGNED: 'Action needed: a match has no referee',
};

const enqueueRefereeEmail = (
  tx: Parameters<Parameters<typeof serializableTransaction>[0]>[0],
  input: { kind: RefereeEmailKind; matchId: string; userId: string; eventKey: string },
) =>
  enqueueDurableJob(tx, {
    type: REFEREE_EMAIL_JOB_TYPE,
    dedupeKey: `referee-email:${input.kind}:${input.matchId}:${input.eventKey}:${input.userId}`,
    payload: input,
    runAt: new Date(),
  });

const payloadOf = (payload: unknown) =>
  (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as Record<string, unknown>;
const invalid = () => Object.assign(new Error('Invalid referee job payload.'), { code: 'JOB_PAYLOAD_INVALID' });

const matchSelect = { id: true, name: true, startsAt: true, status: true, venue: { select: { name: true } } } as const;

export class RefereeJobs {
  constructor(
    private readonly notifications = new NotificationsService(),
    private readonly emails: EmailProvider = createEmailProvider(),
  ) {}

  /** D2 / D16 / D28: alert every active admin while an upcoming match has no active referee. */
  async alertUnassigned(payload: unknown, now = new Date()) {
    const { matchId, alertKey } = payloadOf(payload);
    if (typeof matchId !== 'string') throw invalid();
    const key = typeof alertKey === 'string' ? alertKey : 'alert';
    const created = await serializableTransaction(async (tx) => {
      const match = await tx.match.findUnique({ where: { id: matchId }, select: matchSelect });
      if (!match || !['OPEN', 'READY'].includes(match.status) || now >= match.startsAt) return [] as Notification[];
      if (await hasActiveReferee(tx, matchId)) return [] as Notification[];
      const admins = await tx.user.findMany({ where: { platformRole: 'ADMIN', accountStatus: 'ACTIVE' }, select: { id: true } });
      const message = refereeMessage('ADMIN_REFEREE_UNASSIGNED', { name: match.name, startsAt: match.startsAt, venueName: match.venue.name });
      const drafts: NotificationDraft[] = admins.map(({ id }) => ({
        userId: id,
        type: 'ADMIN_ALERT',
        title: 'Match needs a referee',
        message,
        dedupeKey: notificationDedupeKey('referee-unassigned', matchId, key, id),
      }));
      for (const { id } of admins)
        await enqueueRefereeEmail(tx, { kind: 'ADMIN_REFEREE_UNASSIGNED', matchId, userId: id, eventKey: key });
      return persistNotifications(tx, drafts);
    });
    this.notifications.publishPersistedMany(created);
    return created;
  }

  /** D19: the referee is told in-app and by email when they are assigned to or removed from a match. */
  async notice(payload: unknown) {
    const { assignmentId } = payloadOf(payload);
    if (typeof assignmentId !== 'string') throw invalid();
    const created = await serializableTransaction(async (tx) => {
      const entry = await tx.matchRefereeAssignment.findUnique({
        where: { id: assignmentId },
        select: { id: true, action: true, refereeUserId: true, match: { select: matchSelect } },
      });
      if (!entry || entry.action === 'DECLINED') return [] as Notification[];
      const assigned = entry.action === 'ASSIGNED' || entry.action === 'AUTO_ASSIGNED';
      const kind: RefereeEmailKind = assigned ? 'REFEREE_ASSIGNED' : 'REFEREE_REMOVED';
      const { match } = entry;
      await enqueueRefereeEmail(tx, { kind, matchId: match.id, userId: entry.refereeUserId, eventKey: entry.id });
      return persistNotifications(tx, [{
        userId: entry.refereeUserId,
        type: assigned ? 'REFEREE_ASSIGNED' : 'REFEREE_UNASSIGNED',
        title: assigned ? 'You have a match to referee' : 'Referee assignment removed',
        message: refereeMessage(kind, { name: match.name, startsAt: match.startsAt, venueName: match.venue.name }),
        targetPath: '/referee',
        dedupeKey: notificationDedupeKey('referee-notice', entry.id),
      }]);
    });
    this.notifications.publishPersistedMany(created);
    return created;
  }

  async email(payload: unknown) {
    const { kind, matchId, userId } = payloadOf(payload);
    if (typeof matchId !== 'string' || typeof userId !== 'string' || !EMAIL_KINDS.includes(kind as RefereeEmailKind)) throw invalid();
    const emailKind = kind as RefereeEmailKind;
    const [match, user] = await Promise.all([
      prisma.match.findUnique({ where: { id: matchId }, select: matchSelect }),
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ]);
    if (!match || !user?.email) return;
    // An unassigned alert is pointless once the match is cancelled or has a referee again.
    if (emailKind === 'ADMIN_REFEREE_UNASSIGNED'
      && (match.status === 'CANCELLED' || (await prisma.match.count({ where: { id: matchId, refereeUserId: { not: null } } }))))
      return;
    const text = refereeMessage(emailKind, { name: match.name, startsAt: match.startsAt, venueName: match.venue.name });
    const link = emailKind === 'ADMIN_REFEREE_UNASSIGNED'
      ? `${env.ADMIN_CLIENT_URL.replace(/\/$/, '')}/match-referees`
      : `${env.CLIENT_URL.replace(/\/$/, '')}/referee`;
    await this.emails.send({ to: user.email, subject: REFEREE_EMAIL_SUBJECT[emailKind], text: `${text}\n\n${link}` });
  }
}

export const registerRefereeJobHandlers = (jobs = new RefereeJobs()) => {
  registerDurableJobHandler(REFEREE_UNASSIGNED_ALERT_JOB_TYPE, async (payload) => {
    await jobs.alertUnassigned(payload);
  });
  registerDurableJobHandler(REFEREE_NOTICE_JOB_TYPE, async (payload) => {
    await jobs.notice(payload);
  });
  registerDurableJobHandler(REFEREE_EMAIL_JOB_TYPE, (payload) => jobs.email(payload));
};
