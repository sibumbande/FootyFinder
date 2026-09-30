import { getGoNoGoAt } from '@footy-finder/shared';
import { prisma } from '../../src/database/prisma.js';
import { serializableTransaction } from '../../src/database/transaction.js';
import { appendAdminAudit } from '../../src/modules/admin/admin-audit.js';
import { FILL_REMINDER_JOB_TYPE, getFillReminderAt } from '../../src/modules/matches/fill-reminder.js';
import { GO_NO_GO_JOB_TYPE } from '../../src/modules/matches/go-no-go.js';
import { REFEREE_UNASSIGNED_ALERT_JOB_TYPE, findRefereeClash, refereeAlertAt } from '../../src/modules/referees/referee-assignment.js';
import {
  TEAM_MATCH_NO_OPPONENT_WARNING_JOB_TYPE,
  TEAM_MATCH_UNMATCHED_CANCEL_JOB_TYPE,
  noOpponentWarningAt,
  unmatchedCancelAt,
} from '../../src/modules/team-matches/team-match-jobs.js';
import { TEAM_MATCH_GO_NO_GO_JOB_TYPE, TEAM_METER_REMINDER_JOB_TYPE } from '../../src/modules/team-matches/team-match-meters.js';
import { DEV_SEED, DEV_SEED_BATCH_LABEL, isDevSeedMatchName } from './world.js';

/**
 * The run time the app itself would give a kickoff-relative job for a match kicking off at
 * `startsAt`, using the app's own timing functions. Null for jobs that are not tied to kickoff
 * (emails and notices that run straight away); those are never moved.
 */
export function kickoffRelativeRunAt(type: string, dedupeKey: string, startsAt: Date, now: Date): Date | null {
  switch (type) {
    case GO_NO_GO_JOB_TYPE:
    case TEAM_MATCH_GO_NO_GO_JOB_TYPE:
      return getGoNoGoAt(startsAt);
    case FILL_REMINDER_JOB_TYPE:
    case TEAM_METER_REMINDER_JOB_TYPE:
      return getFillReminderAt(startsAt);
    case TEAM_MATCH_NO_OPPONENT_WARNING_JOB_TYPE:
      return noOpponentWarningAt(startsAt);
    case TEAM_MATCH_UNMATCHED_CANCEL_JOB_TYPE: {
      // After a withdrawal the app schedules max(now, kickoff - 24h); the first one is kickoff - 24h.
      const at = unmatchedCancelAt(startsAt);
      return dedupeKey.split(':').length > 2 && at < now ? now : at;
    }
    case REFEREE_UNASSIGNED_ALERT_JOB_TYPE:
      return dedupeKey.endsWith(':t-24h') ? refereeAlertAt(startsAt) : null;
    default:
      return null;
  }
}

export class ShiftRefusedError extends Error {}

/**
 * Dev-only time travel: moves a DEV SEED match's kickoff by `minutes` before it has kicked off.
 * In one serializable transaction it moves the kickoff, the T-30 time, the field reservation and
 * the run time of every waiting kickoff-relative job. It never changes a status, money or a
 * result: the normal durable queue and lifecycle scheduler (in the running dev API) do that.
 */
export async function shiftDevSeedMatch(matchId: string, minutes: number, now = new Date()) {
  if (!Number.isInteger(minutes) || minutes === 0) throw new ShiftRefusedError('Give a whole, non-zero number of minutes.');
  return serializableTransaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId}::uuid FOR UPDATE`;
    const match = await tx.match.findUnique({
      where: { id: matchId },
      include: { fieldReservation: true, createdBy: { select: { isTestAccount: true, testDataBatch: { select: { label: true } } } } },
    });
    if (!match) throw new ShiftRefusedError('Match not found.');
    if (!isDevSeedMatchName(match.name) || !match.createdBy.isTestAccount || match.createdBy.testDataBatch?.label !== DEV_SEED_BATCH_LABEL)
      throw new ShiftRefusedError('Only DEV SEED scenario matches can be shifted.');
    if (!['OPEN', 'READY'].includes(match.status) || match.startsAt <= now)
      throw new ShiftRefusedError(`Only a match that has not kicked off can be shifted (status ${match.status}, kickoff ${match.startsAt.toISOString()}).`);
    const delta = minutes * 60_000;
    const startsAt = new Date(match.startsAt.getTime() + delta);
    if (startsAt.getTime() < now.getTime() + 60_000) throw new ShiftRefusedError('The new kickoff must be at least one minute from now.');
    if (match.refereeUserId) {
      const clash = await findRefereeClash(tx, match.refereeUserId, { id: match.id, startsAt, durationMinutes: match.durationMinutes });
      if (clash)
        throw new ShiftRefusedError(`That would double-book the referee with "${clash.name}" at ${clash.startsAt.toISOString()} (D27). Shift that match first, or pick another time.`);
    }
    await tx.match.update({
      where: { id: match.id },
      data: { startsAt, ...(match.goNoGoAt ? { goNoGoAt: getGoNoGoAt(startsAt) } : {}) },
    });
    if (match.fieldReservation) {
      try {
        await tx.fieldReservation.update({
          where: { id: match.fieldReservation.id },
          data: {
            startsAt: new Date(match.fieldReservation.startsAt.getTime() + delta),
            endsAt: new Date(match.fieldReservation.endsAt.getTime() + delta),
          },
        });
      } catch (error) {
        if (String(error).includes('FieldReservation_no_overlap')) throw new ShiftRefusedError('That time overlaps another booking on the same field.');
        throw error;
      }
    }
    const jobs = await tx.durableJob.findMany({ where: { status: 'PENDING', dedupeKey: { contains: match.id } } });
    const moved: Array<{ type: string; runAt: string }> = [];
    for (const job of jobs) {
      const runAt = kickoffRelativeRunAt(job.type, job.dedupeKey, startsAt, now);
      if (!runAt) continue;
      await tx.durableJob.update({ where: { id: job.id }, data: { runAt } });
      moved.push({ type: job.type, runAt: runAt.toISOString() });
    }
    await appendAdminAudit(tx, {
      action: 'DEV_SEED_MATCH_SHIFTED',
      entityType: 'MATCH',
      entityId: match.id,
      metadata: { mark: DEV_SEED, minutes, from: match.startsAt.toISOString(), to: startsAt.toISOString(), jobs: moved },
    });
    return { name: match.name, from: match.startsAt, to: startsAt, goNoGoAt: match.goNoGoAt ? getGoNoGoAt(startsAt) : null, jobs: moved };
  });
}

export const devSeedMatchLink = (matchId: string) => `http://localhost:5173/matches/${matchId}`;
export { prisma };
