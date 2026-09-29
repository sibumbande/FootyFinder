import { getGoNoGoAt } from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';
import { formatKickoffTime } from './cancellation-message.js';

export const FILL_REMINDER_JOB_TYPE = 'QUICK_MATCH_FILL_REMINDER';
/** The reminder runs 2 hours before kickoff, 90 minutes before the T-30 go/no-go check. */
export const FILL_REMINDER_MINUTES_BEFORE_KICKOFF = 120;
/** Only schedule a reminder for matches created more than 2h30m before kickoff. */
export const FILL_REMINDER_MIN_LEAD_MINUTES = 150;
export const fillReminderJobDedupeKey = (matchId: string) => `quick-match-fill-reminder:${matchId}`;

export const getFillReminderAt = (startsAt: Date) =>
  new Date(startsAt.getTime() - FILL_REMINDER_MINUTES_BEFORE_KICKOFF * 60_000);

/**
 * TKT-319: schedule the "not full yet" reminder in the transaction that creates the match. Skipped
 * when the match is created 2h30m or less before kickoff, where a reminder would add nothing.
 */
export const enqueueFillReminderJob = async (
  tx: Prisma.TransactionClient,
  matchId: string,
  startsAt: Date,
  now = new Date(),
) => {
  if (startsAt.getTime() - now.getTime() <= FILL_REMINDER_MIN_LEAD_MINUTES * 60_000) return null;
  return enqueueDurableJob(tx, {
    type: FILL_REMINDER_JOB_TYPE,
    dedupeKey: fillReminderJobDedupeKey(matchId),
    payload: { matchId },
    runAt: getFillReminderAt(startsAt),
  });
};

/**
 * Open formation positions to remind about, or 0 when no reminder is due: legacy (no go/no-go
 * time), cancelled, already confirmed, not OPEN/READY, or every position already claimed.
 */
export const openPositionsForReminder = (match: {
  status: string;
  goNoGoAt: Date | null;
  confirmedAt: Date | null;
  formationSlots: Array<{ participantId: string | null }>;
}) => {
  if (!match.goNoGoAt || match.confirmedAt || !['OPEN', 'READY'].includes(match.status)) return 0;
  return match.formationSlots.filter(({ participantId }) => !participantId).length;
};

/** "3 positions still open. Share the match link or it'll be cancelled at 13:30." */
export const fillReminderMessage = (openPositions: number, startsAt: Date) =>
  `${openPositions} ${openPositions === 1 ? 'position' : 'positions'} still open. Share the match link or it'll be cancelled at ${formatKickoffTime(getGoNoGoAt(startsAt))}.`;
