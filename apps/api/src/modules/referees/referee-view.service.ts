import {
  getEffectiveMatchStatus,
  getMatchEndsAt,
  type MatchLineupPlayer,
  type RefereeMatchDetail,
  type RefereeMatchSummary,
} from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../errors/app-error.js';
import { buildLineup } from '../matches/lineup-record.js';
import { isActiveReferee } from './referee-status.js';

const RECENT_DAYS = 7;

const summarySelect = {
  id: true,
  name: true,
  mode: true,
  format: true,
  status: true,
  startsAt: true,
  durationMinutes: true,
  goNoGoAt: true,
  confirmedAt: true,
  venue: { select: { name: true, addressLine1: true, city: true } },
  teamSides: { select: { side: true, teamNameSnapshot: true } },
  result: {
    select: {
      outcomeType: true,
      homeScore: true,
      awayScore: true,
      forfeitWinner: true,
      finalSource: true,
      finalizedAt: true,
      goals: {
        orderBy: { sortOrder: 'asc' as const },
        select: {
          side: true,
          ownGoal: true,
          scorer: { select: { userId: true, displayNameSnapshot: true } },
          assist: { select: { userId: true, displayNameSnapshot: true } },
        },
      },
    },
  },
} satisfies Prisma.MatchSelect;
type SummaryRow = Prisma.MatchGetPayload<{ select: typeof summarySelect }>;

const toSummary = (row: SummaryRow, now: Date): RefereeMatchSummary => {
  const status = getEffectiveMatchStatus({ status: row.status, startsAt: row.startsAt, durationMinutes: row.durationMinutes }, now);
  const sideName = (side: 'HOME' | 'AWAY') =>
    row.teamSides.find((teamSide) => teamSide.side === side)?.teamNameSnapshot
    ?? (side === 'HOME' ? 'Team A' : row.mode === 'TEAM_MATCH' ? 'Individual players' : 'Team B');
  return {
    matchId: row.id,
    name: row.name,
    mode: row.mode,
    format: row.format,
    status,
    startsAt: row.startsAt.toISOString(),
    matchEndsAt: getMatchEndsAt(row).toISOString(),
    goNoGoAt: row.goNoGoAt?.toISOString() ?? null,
    confirmed: Boolean(row.confirmedAt),
    venue: row.venue,
    sides: { HOME: sideName('HOME'), AWAY: sideName('AWAY') },
    hasResult: Boolean(row.result),
    canDecline: !row.result && Boolean(row.goNoGoAt) && now < row.goNoGoAt! && ['OPEN', 'READY'].includes(row.status),
    canRecordResult: !row.result && ['IN_PROGRESS', 'AWAITING_RESULT'].includes(row.status),
  };
};

/**
 * Gate 8 / TKT-805 (DEC-020): what a FootyFinder referee sees. Only their own assigned matches;
 * player display names, positions and sides (ToS 8.3), never contact, payment or venue-cost data.
 */
export class RefereeViewService {
  private async assertReferee(userId: string) {
    if (!(await isActiveReferee(prisma, userId)))
      throw new AppError(403, 'Only FootyFinder referees can open the referee view.', 'NOT_A_REFEREE');
  }

  async listMine(userId: string, now = new Date()): Promise<RefereeMatchSummary[]> {
    await this.assertReferee(userId);
    const rows = await prisma.match.findMany({
      where: {
        refereeUserId: userId,
        status: { not: 'CANCELLED' },
        startsAt: { gt: new Date(now.getTime() - RECENT_DAYS * 86_400_000) },
      },
      select: summarySelect,
      orderBy: { startsAt: 'asc' },
      take: 100,
    });
    return rows.map((row) => toSummary(row, now));
  }

  async detail(matchId: string, userId: string, now = new Date()): Promise<RefereeMatchDetail> {
    await this.assertReferee(userId);
    const row = await prisma.match.findFirst({ where: { id: matchId, refereeUserId: userId }, select: summarySelect });
    if (!row) throw new AppError(404, 'You are not the referee for this match.', 'NOT_MATCH_REFEREE');
    const recorded = await prisma.matchLineupEntry.findMany({
      where: { matchId },
      select: { userId: true, displayNameSnapshot: true, side: true, role: true, slotIndex: true, didNotPlay: true },
    });
    const lineup: MatchLineupPlayer[] = recorded.length
      ? recorded.map(({ displayNameSnapshot, ...entry }) => ({ ...entry, displayName: displayNameSnapshot }))
      : (await buildLineup(prisma, matchId)).map((entry) => ({
          userId: entry.userId,
          displayName: entry.displayNameSnapshot,
          side: entry.side,
          role: entry.role,
          slotIndex: entry.slotIndex,
          didNotPlay: false,
        }));
    lineup.sort((a, b) =>
      a.side.localeCompare(b.side) || (a.role === b.role ? 0 : a.role === 'STARTER' ? -1 : 1) || a.displayName.localeCompare(b.displayName));
    return {
      ...toSummary(row, now),
      lineupRecorded: recorded.length > 0,
      lineup,
      result: row.result
        ? {
            outcomeType: row.result.outcomeType,
            homeScore: row.result.homeScore,
            awayScore: row.result.awayScore,
            forfeitWinner: row.result.forfeitWinner,
            finalSource: row.result.finalSource,
            finalizedAt: row.result.finalizedAt?.toISOString() ?? null,
            goals: row.result.goals.map((goal) => ({
              side: goal.side,
              ownGoal: goal.ownGoal,
              scorer: goal.scorer ? { userId: goal.scorer.userId, displayName: goal.scorer.displayNameSnapshot } : null,
              assist: goal.assist ? { userId: goal.assist.userId, displayName: goal.assist.displayNameSnapshot } : null,
            })),
          }
        : null,
    };
  }
}
