import type { TeamFormEntry, TeamStats } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';

type Side = 'HOME' | 'AWAY';
export type TeamResultRow = {
  matchId: string;
  startsAt: Date;
  side: Side;
  opponent: string;
  outcomeType: 'PLAYED' | 'FORFEIT' | 'ABANDONED';
  homeScore: number;
  awayScore: number;
  forfeitWinner: Side | null;
};

/**
 * CEO touch-up batch 4, item 2: a team's statistics, with the player-statistics rules (ToS 16.11). Abandoned matches
 * are skipped; a forfeit counts as a win or a loss with no goals; goal difference = for - against. The last five
 * results are newest first.
 */
export function aggregateTeamStats(rows: TeamResultRow[]): TeamStats {
  const counted = rows.filter(({ outcomeType }) => outcomeType !== 'ABANDONED').sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  const entries: TeamFormEntry[] = counted.map((row) => {
    const forfeit = row.outcomeType === 'FORFEIT';
    const goalsFor = forfeit ? 0 : row.side === 'HOME' ? row.homeScore : row.awayScore;
    const goalsAgainst = forfeit ? 0 : row.side === 'HOME' ? row.awayScore : row.homeScore;
    const outcome = forfeit ? (row.forfeitWinner === row.side ? 'W' : 'L') : goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
    return { matchId: row.matchId, startsAt: row.startsAt.toISOString(), outcome, opponent: row.opponent, goalsFor, goalsAgainst, forfeit };
  });
  const goalsFor = entries.reduce((sum, entry) => sum + entry.goalsFor, 0);
  const goalsAgainst = entries.reduce((sum, entry) => sum + entry.goalsAgainst, 0);
  return {
    played: entries.length,
    wins: entries.filter(({ outcome }) => outcome === 'W').length,
    draws: entries.filter(({ outcome }) => outcome === 'D').length,
    losses: entries.filter(({ outcome }) => outcome === 'L').length,
    goalsFor,
    goalsAgainst,
    goalDifference: goalsFor - goalsAgainst,
    lastFive: entries.slice(0, 5),
  };
}

/**
 * Final results only: referee- or admin-final results, plus pre-Gate-8 (legacy) results not under an open dispute,
 * of completed matches the team played in (D6). The opponent is the other team, or "Individual players" when
 * players took the other side.
 */
export async function teamStats(teamId: string): Promise<TeamStats> {
  const sides = await prisma.matchTeam.findMany({
    where: { teamId, match: { status: 'COMPLETED', result: { isNot: null } } },
    select: {
      side: true,
      match: {
        select: {
          id: true,
          startsAt: true,
          teamSides: { select: { side: true, teamNameSnapshot: true } },
          result: { select: { id: true, finalSource: true, outcomeType: true, homeScore: true, awayScore: true, forfeitWinner: true } },
        },
      },
    },
  });
  const legacyIds = sides.flatMap(({ match }) => (match.result?.finalSource === 'LEGACY' ? [match.result.id] : []));
  const disputed = legacyIds.length
    ? new Set((await prisma.dispute.findMany({
        where: { type: 'MATCH_RESULT', referenceId: { in: legacyIds }, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
        select: { referenceId: true },
      })).map(({ referenceId }) => referenceId))
    : new Set<string>();
  return aggregateTeamStats(
    sides.flatMap(({ side, match }) => {
      const result = match.result;
      if (!result || disputed.has(result.id)) return [];
      return [{
        matchId: match.id,
        startsAt: match.startsAt,
        side,
        opponent: match.teamSides.find((other) => other.side !== side)?.teamNameSnapshot ?? 'Individual players',
        outcomeType: result.outcomeType,
        homeScore: result.homeScore,
        awayScore: result.awayScore,
        forfeitWinner: result.forfeitWinner,
      }];
    }),
  );
}
