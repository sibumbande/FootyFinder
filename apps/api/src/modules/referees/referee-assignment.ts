import {
  REFEREE_TRAVEL_BUFFER_MINUTES,
  REFEREE_UNASSIGNED_ALERT_HOURS,
  getMatchEndsAt,
  type RefereeAssignmentAction,
} from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';
import { isActiveReferee } from './referee-status.js';

/**
 * Gate 8 / TKT-802 (DEC-020): one FootyFinder referee per match.
 * - Every match with a T-30 go/no-go (DEC-018 Quick Matches and DEC-019 team matches) needs one.
 * - D28: on publish the default referee is assigned automatically when free; otherwise the match
 *   is unassigned and admins are alerted straight away. D2: admins are alerted again at kickoff
 *   -24h while it is still unassigned, and the T-30 go/no-go cancels a match with no referee.
 * - D27: a referee cannot be given two matches whose busy windows (kickoff to scheduled end plus
 *   30 minutes of travel) overlap. Checked under a lock on the referee's User row, so two
 *   concurrent assignments of one referee are serialized.
 * - D17 (reversed): a referee may also play in a match they referee; nothing checks the lineup.
 * Assignment history is permanent (MatchRefereeAssignment). Notices and admin alerts are durable
 * jobs, so they are sent once and only after the change has committed.
 */
export const REFEREE_UNASSIGNED_ALERT_JOB_TYPE = 'REFEREE_UNASSIGNED_ALERT';
export const REFEREE_NOTICE_JOB_TYPE = 'REFEREE_NOTICE';
export const REFEREE_EMAIL_JOB_TYPE = 'REFEREE_EMAIL';

export const refereeUnassignedAlertDedupeKey = (matchId: string, key: string) => `referee-unassigned-alert:${matchId}:${key}`;
export const refereeAlertAt = (startsAt: Date) => new Date(startsAt.getTime() - REFEREE_UNASSIGNED_ALERT_HOURS * 3_600_000);

const lockMatch = (tx: Prisma.TransactionClient, matchId: string) =>
  tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId}::uuid FOR UPDATE`;
const lockUser = (tx: Prisma.TransactionClient, userId: string) =>
  tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;

type RefereedMatch = { id: string; startsAt: Date; durationMinutes: number };

/**
 * D27: the first of the referee's other live matches whose busy window overlaps this one, if any.
 * Cancelled and completed matches never clash.
 */
export async function findRefereeClash(tx: Prisma.TransactionClient, refereeUserId: string, match: RefereedMatch) {
  const end = new Date(getMatchEndsAt(match).getTime() + REFEREE_TRAVEL_BUFFER_MINUTES * 60_000);
  const rows = await tx.$queryRaw<Array<{ id: string; name: string; startsAt: Date; durationMinutes: number }>>`
    SELECT "id", "name", "startsAt", "durationMinutes" FROM "Match"
    WHERE "refereeUserId" = ${refereeUserId}::uuid
      AND "id" <> ${match.id}::uuid
      AND "status" NOT IN ('CANCELLED', 'COMPLETED')
      AND "startsAt" < ${end}
      AND "startsAt" + (("durationMinutes" + ${REFEREE_TRAVEL_BUFFER_MINUTES}) * INTERVAL '1 minute') > ${match.startsAt}
    ORDER BY "startsAt" ASC
    LIMIT 1`;
  return rows[0] ?? null;
}

const recordHistory = async (
  tx: Prisma.TransactionClient,
  input: { matchId: string; action: RefereeAssignmentAction; refereeUserId: string; actorUserId: string | null; reason?: string | null },
) => {
  const entry = await tx.matchRefereeAssignment.create({
    data: {
      matchId: input.matchId,
      action: input.action,
      refereeUserId: input.refereeUserId,
      actorUserId: input.actorUserId,
      reason: input.reason ?? null,
    },
  });
  // The referee hears about being assigned or removed (D19); declining is their own action.
  if (input.action !== 'DECLINED')
    await enqueueDurableJob(tx, {
      type: REFEREE_NOTICE_JOB_TYPE,
      dedupeKey: `referee-notice:${entry.id}`,
      payload: { assignmentId: entry.id },
      runAt: new Date(),
    });
  return entry;
};

/** Admins are alerted straight away (D28 publish, D16 decline, removals) while a match is unassigned. */
export const enqueueUnassignedAlertNow = (tx: Prisma.TransactionClient, matchId: string, key: string) =>
  enqueueDurableJob(tx, {
    type: REFEREE_UNASSIGNED_ALERT_JOB_TYPE,
    dedupeKey: refereeUnassignedAlertDedupeKey(matchId, key),
    payload: { matchId, alertKey: key },
    runAt: new Date(),
  });

const loadAssignable = async (tx: Prisma.TransactionClient, matchId: string, now: Date) => {
  await lockMatch(tx, matchId);
  const match = await tx.match.findUnique({
    where: { id: matchId },
    select: { id: true, status: true, startsAt: true, durationMinutes: true, goNoGoAt: true, refereeUserId: true },
  });
  if (!match) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
  if (!match.goNoGoAt)
    throw new AppError(409, 'This match does not take a FootyFinder referee.', 'MATCH_NOT_REFEREED');
  if (['CANCELLED', 'COMPLETED', 'DRAFT'].includes(match.status) || now >= getMatchEndsAt(match))
    throw new AppError(409, 'This match can no longer be given a referee.', 'MATCH_REFEREE_CLOSED');
  return match;
};

/**
 * Assigns (or changes) the referee. Returns 'UNCHANGED' when that referee is already assigned.
 * Throws REFEREE_NOT_ACTIVE for someone without an active referee role, and REFEREE_BUSY (with the
 * clashing match) when the D27 windows overlap.
 */
export async function assignRefereeInTx(
  tx: Prisma.TransactionClient,
  input: { matchId: string; refereeUserId: string; actorUserId: string | null; action: 'ASSIGNED' | 'AUTO_ASSIGNED'; reason?: string | null },
  now = new Date(),
) {
  const match = await loadAssignable(tx, input.matchId, now);
  if (match.refereeUserId === input.refereeUserId) return { outcome: 'UNCHANGED' as const };
  await lockUser(tx, input.refereeUserId);
  if (!(await isActiveReferee(tx, input.refereeUserId)))
    throw new AppError(409, 'This person is not an active referee.', 'REFEREE_NOT_ACTIVE');
  const clash = await findRefereeClash(tx, input.refereeUserId, match);
  if (clash)
    throw new AppError(409, `This referee is busy with ${clash.name} at that time.`, 'REFEREE_BUSY', {
      clash: {
        matchId: clash.id,
        name: clash.name,
        startsAt: clash.startsAt.toISOString(),
        matchEndsAt: getMatchEndsAt(clash).toISOString(),
      },
    });
  if (match.refereeUserId)
    await recordHistory(tx, {
      matchId: match.id,
      action: 'REMOVED',
      refereeUserId: match.refereeUserId,
      actorUserId: input.actorUserId,
      reason: input.reason ?? 'Replaced by another referee',
    });
  await tx.match.update({
    where: { id: match.id },
    data: { refereeUserId: input.refereeUserId, refereeAssignedAt: now },
  });
  const entry = await recordHistory(tx, {
    matchId: match.id,
    action: input.action,
    refereeUserId: input.refereeUserId,
    actorUserId: input.actorUserId,
    reason: input.reason,
  });
  return { outcome: 'ASSIGNED' as const, assignmentId: entry.id };
}

/**
 * Removes the referee: an admin removal (REMOVED), the referee declining (DECLINED, D16) or the
 * role being revoked (ROLE_REVOKED). While the match has not kicked off, admins are alerted.
 */
export async function removeRefereeInTx(
  tx: Prisma.TransactionClient,
  input: { matchId: string; actorUserId: string | null; action: 'REMOVED' | 'DECLINED' | 'ROLE_REVOKED'; reason: string; expectedRefereeUserId?: string },
  now = new Date(),
) {
  const match = await loadAssignable(tx, input.matchId, now);
  if (!match.refereeUserId || (input.expectedRefereeUserId && match.refereeUserId !== input.expectedRefereeUserId))
    throw new AppError(409, 'This match has no referee to remove.', 'MATCH_HAS_NO_REFEREE');
  await tx.match.update({ where: { id: match.id }, data: { refereeUserId: null, refereeAssignedAt: null } });
  const entry = await recordHistory(tx, {
    matchId: match.id,
    action: input.action,
    refereeUserId: match.refereeUserId,
    actorUserId: input.actorUserId,
    reason: input.reason,
  });
  if (now < match.startsAt) await enqueueUnassignedAlertNow(tx, match.id, entry.id);
  return { assignmentId: entry.id, refereeUserId: match.refereeUserId };
}

/**
 * Called in the transaction that publishes a refereed match (Quick Match, admin-loaded match, team
 * match). D28: assign the default referee if they are an active referee and free; otherwise alert
 * admins now. D2: schedule the kickoff -24h alert (it does nothing if a referee is assigned by then).
 */
export async function onRefereedMatchPublished(tx: Prisma.TransactionClient, match: RefereedMatch, now = new Date()) {
  const settings = await tx.refereeSettings.findUnique({ where: { id: 1 }, select: { defaultRefereeUserId: true } });
  let assigned = false;
  if (settings?.defaultRefereeUserId) {
    await lockUser(tx, settings.defaultRefereeUserId);
    if ((await isActiveReferee(tx, settings.defaultRefereeUserId)) && !(await findRefereeClash(tx, settings.defaultRefereeUserId, match))) {
      await tx.match.update({
        where: { id: match.id },
        data: { refereeUserId: settings.defaultRefereeUserId, refereeAssignedAt: now },
      });
      await recordHistory(tx, {
        matchId: match.id,
        action: 'AUTO_ASSIGNED',
        refereeUserId: settings.defaultRefereeUserId,
        actorUserId: null,
        reason: 'Default referee',
      });
      assigned = true;
    }
  }
  if (!assigned) await enqueueUnassignedAlertNow(tx, match.id, 'published');
  if (refereeAlertAt(match.startsAt) > now)
    await enqueueDurableJob(tx, {
      type: REFEREE_UNASSIGNED_ALERT_JOB_TYPE,
      dedupeKey: refereeUnassignedAlertDedupeKey(match.id, 't-24h'),
      payload: { matchId: match.id, alertKey: 't-24h' },
      runAt: refereeAlertAt(match.startsAt),
    });
  return { autoAssigned: assigned };
}

/** D2: the T-30 go/no-go needs an assigned referee who still holds an active referee role. */
export async function hasActiveReferee(tx: Prisma.TransactionClient, matchId: string) {
  const match = await tx.match.findUnique({ where: { id: matchId }, select: { refereeUserId: true } });
  return Boolean(match?.refereeUserId) && (await isActiveReferee(tx, match!.refereeUserId!));
}
