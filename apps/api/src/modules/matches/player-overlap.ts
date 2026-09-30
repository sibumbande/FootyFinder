import { REFEREE_TRAVEL_BUFFER_MINUTES, getMatchEndsAt } from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';

type Db = Prisma.TransactionClient;
export type TimedMatch = { id: string; startsAt: Date; durationMinutes: number };
export type OverlapClash = { id: string; name: string; startsAt: Date; userId: string };

/**
 * Gate 9 / TKT-908 (CEO, found in live testing 30 Sep 2026): a player cannot be in two matches whose
 * windows overlap. "In a match" means joined as a player, selected as a starter or substitute in a
 * team lineup (or holding a claimed open slot), or refereeing it. The window is the referee
 * double-booking window: kickoff to scheduled end plus 30 minutes. Cancelled and completed matches
 * never clash. Playing in the match you referee is the same match, so it is allowed (D17).
 */
export async function overlappingMatches(db: Db, userIds: string[], match: TimedMatch): Promise<OverlapClash[]> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return [];
  const end = new Date(getMatchEndsAt(match).getTime() + REFEREE_TRAVEL_BUFFER_MINUTES * 60_000);
  return db.$queryRaw<OverlapClash[]>`
    SELECT DISTINCT ON (u."userId") u."userId", m."id", m."name", m."startsAt"
    FROM unnest(${ids}::uuid[]) AS u("userId")
    JOIN "Match" m ON m."id" <> ${match.id}::uuid
      AND m."status" NOT IN ('CANCELLED', 'COMPLETED')
      AND m."startsAt" < ${end}
      AND m."startsAt" + ((m."durationMinutes" + ${REFEREE_TRAVEL_BUFFER_MINUTES}) * INTERVAL '1 minute') > ${match.startsAt}
    WHERE m."refereeUserId" = u."userId"
      OR EXISTS (SELECT 1 FROM "MatchParticipant" p WHERE p."matchId" = m."id" AND p."userId" = u."userId" AND p."status" = 'JOINED')
      OR EXISTS (
        SELECT 1 FROM "TeamMatchSelection" s JOIN "MatchTeam" t ON t."id" = s."matchTeamId"
        WHERE t."matchId" = m."id" AND s."userId" = u."userId"
          AND s."status" IN ('SELECTED_STARTER', 'OPEN_SLOT_CLAIMED', 'SELECTED_SUBSTITUTE'))
    ORDER BY u."userId", m."startsAt" ASC`;
}

/** Locks the players' rows so two joins for the same player in different matches cannot race. */
export async function lockPlayers(db: Db, userIds: string[]) {
  const ids = [...new Set(userIds)].sort();
  if (ids.length) await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ANY(${ids}::uuid[]) ORDER BY "id" FOR UPDATE`;
}

export class PlayerOverlapError extends Error {
  constructor(readonly clash: OverlapClash, readonly self: boolean) {
    super('PLAYER_MATCH_OVERLAP');
  }
}

/** Throws PlayerOverlapError when the player is already in an overlapping match. */
export async function assertNoPlayerOverlap(db: Db, userId: string, match: TimedMatch, self = true) {
  await lockPlayers(db, [userId]);
  const [clash] = await overlappingMatches(db, [userId], match);
  if (clash) throw new PlayerOverlapError(clash, self);
}

const clock = (date: Date) =>
  new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);

export const playerOverlapAppError = (error: PlayerOverlapError) =>
  new AppError(
    409,
    error.self
      ? `You're already in another match at this time (${error.clash.name}, ${clock(error.clash.startsAt)}). A player can't be in two matches whose times overlap.`
      : `This player is already in another match at this time (${error.clash.name}, ${clock(error.clash.startsAt)}). A player can't be in two matches whose times overlap.`,
    'PLAYER_MATCH_OVERLAP',
    { matchId: error.clash.id },
  );
