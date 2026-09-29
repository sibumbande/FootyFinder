import { TEAM_MATCH_UNMATCHED_CANCEL_HOURS, type TeamMatchOtherSideMode } from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';
import { enqueueFillReminderJob } from '../matches/fill-reminder.js';
import { formatKickoffTime, formatMatchDate } from '../matches/cancellation-message.js';

/**
 * Gate 7 / TKT-706 durable jobs for DEC-019 team matches.
 * - "Teams only" (D10 as narrowed by decision E): a match whose other side no team has taken is
 *   cancelled 24 hours before kickoff; the home team is warned 48 hours before kickoff. Both are
 *   scheduled only when the match is published early enough for them to make sense; otherwise the
 *   T-30 go/no-go decides.
 * - "Open to both": the DEC-018 kickoff-2h "positions still open" reminder.
 */
export const TEAM_MATCH_UNMATCHED_CANCEL_JOB_TYPE = 'TEAM_MATCH_UNMATCHED_CANCEL';
export const TEAM_MATCH_NO_OPPONENT_WARNING_JOB_TYPE = 'TEAM_MATCH_NO_OPPONENT_WARNING';
export const TEAM_MATCH_EMAIL_JOB_TYPE = 'TEAM_MATCH_EMAIL';
export const TEAM_MATCH_NO_OPPONENT_WARNING_HOURS = 48;
const HOUR_MS = 3_600_000;

export const unmatchedCancelAt = (startsAt: Date) => new Date(startsAt.getTime() - TEAM_MATCH_UNMATCHED_CANCEL_HOURS * HOUR_MS);
export const noOpponentWarningAt = (startsAt: Date) => new Date(startsAt.getTime() - TEAM_MATCH_NO_OPPONENT_WARNING_HOURS * HOUR_MS);
export const unmatchedCancelDedupeKey = (matchId: string, suffix?: string) =>
  `team-match-unmatched-cancel:${matchId}${suffix ? `:${suffix}` : ''}`;
export const noOpponentWarningDedupeKey = (matchId: string) => `team-match-no-opponent-warning:${matchId}`;

/** Scheduled in the transaction that publishes the team match. */
export async function enqueueTeamMatchSideJobs(
  tx: Prisma.TransactionClient,
  match: { id: string; startsAt: Date; otherSideMode: TeamMatchOtherSideMode },
  now = new Date(),
) {
  if (match.otherSideMode === 'OPEN') return enqueueFillReminderJob(tx, match.id, match.startsAt, now);
  if (unmatchedCancelAt(match.startsAt) > now)
    await enqueueDurableJob(tx, {
      type: TEAM_MATCH_UNMATCHED_CANCEL_JOB_TYPE,
      dedupeKey: unmatchedCancelDedupeKey(match.id),
      payload: { matchId: match.id },
      runAt: unmatchedCancelAt(match.startsAt),
    });
  if (noOpponentWarningAt(match.startsAt) > now)
    await enqueueDurableJob(tx, {
      type: TEAM_MATCH_NO_OPPONENT_WARNING_JOB_TYPE,
      dedupeKey: noOpponentWarningDedupeKey(match.id),
      payload: { matchId: match.id },
      runAt: noOpponentWarningAt(match.startsAt),
    });
  return null;
}

/**
 * N5: after a team withdraws from a "Teams only" match, the unmatched rule applies again. If the
 * 24-hour point has already passed, the check runs straight away (a fresh key per withdrawal).
 */
export const enqueueUnmatchedCancelAfterWithdrawal = (
  tx: Prisma.TransactionClient,
  match: { id: string; startsAt: Date },
  withdrawalId: string,
  now = new Date(),
) =>
  enqueueDurableJob(tx, {
    type: TEAM_MATCH_UNMATCHED_CANCEL_JOB_TYPE,
    dedupeKey: unmatchedCancelDedupeKey(match.id, withdrawalId),
    payload: { matchId: match.id },
    runAt: unmatchedCancelAt(match.startsAt) > now ? unmatchedCancelAt(match.startsAt) : now,
  });

/** Operational team-match emails (section 3A): opponent found, no opponent yet, opponent withdrew. */
export type TeamMatchEmailKind = 'OPPONENT_FOUND' | 'NO_OPPONENT_WARNING' | 'OPPONENT_WITHDRAWN';
export const enqueueTeamMatchEmail = (
  tx: Prisma.TransactionClient,
  input: { matchId: string; userId: string; kind: TeamMatchEmailKind; eventKey: string; otherTeamName?: string | null },
) =>
  enqueueDurableJob(tx, {
    type: TEAM_MATCH_EMAIL_JOB_TYPE,
    dedupeKey: `team-match-email:${input.kind}:${input.matchId}:${input.eventKey}:${input.userId}`,
    payload: { matchId: input.matchId, userId: input.userId, kind: input.kind, otherTeamName: input.otherTeamName ?? null },
    runAt: new Date(),
  });

const when = (startsAt: Date) => `${formatMatchDate(startsAt)} at ${formatKickoffTime(startsAt)}`;

/** Shared wording for the in-app notice and the email. */
export const teamMatchMessage = (
  kind: TeamMatchEmailKind,
  match: { name: string; startsAt: Date; venueName: string; otherTeamName?: string | null },
) => {
  switch (kind) {
    case 'OPPONENT_FOUND':
      return `${match.otherTeamName ?? 'A team'} took the other side of ${match.name} at ${match.venueName} on ${when(match.startsAt)}. Fill your team's meter from the team wallet before the 30-minute check.`;
    case 'NO_OPPONENT_WARNING':
      return `No team has taken the other side of ${match.name} (${when(match.startsAt)}) yet. If nobody takes it by ${when(unmatchedCancelAt(match.startsAt))}, the match is cancelled. Share the match link with other teams.`;
    case 'OPPONENT_WITHDRAWN':
      return `${match.otherTeamName ?? 'The other team'} withdrew from ${match.name} (${when(match.startsAt)}). The other side is open again, so another opponent can take it.`;
  }
};

export const TEAM_MATCH_EMAIL_SUBJECT: Record<TeamMatchEmailKind, string> = {
  OPPONENT_FOUND: 'Your team match has an opponent',
  NO_OPPONENT_WARNING: 'Your team match has no opponent yet',
  OPPONENT_WITHDRAWN: 'The other team withdrew from your match',
};
