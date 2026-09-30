import type { PlayerStatistics } from '@footy-finder/shared';

/** One match that counts for a player's statistics, from either source. */
export interface StatisticsRecord {
  side: 'HOME' | 'AWAY';
  outcomeType: 'PLAYED' | 'FORFEIT' | 'ABANDONED';
  homeScore: number;
  awayScore: number;
  forfeitWinner: 'HOME' | 'AWAY' | null;
  goals: number;
  assists: number;
}

/**
 * Gate 8 / TKT-808 (DEC-020): profile statistics. The repository passes only matches that count:
 * referee-final or admin-final results (and pre-Gate-8 self-reported results, D20), never cancelled
 * or abandoned matches, and only players who played (D14). A forfeit counts as a win or loss with
 * no goals; own goals credit nobody (D7). Statistics are recalculated from the results every time,
 * so a correction flows through by itself and nothing is ever counted twice.
 */
export function aggregatePlayerStatistics(records: readonly StatisticsRecord[]): PlayerStatistics {
  const summary: PlayerStatistics = { matchesPlayed: 0, wins: 0, draws: 0, losses: 0, goals: 0, assists: 0 };
  for (const record of records) {
    if (record.outcomeType === 'ABANDONED') continue;
    summary.matchesPlayed += 1;
    if (record.outcomeType === 'FORFEIT') {
      if (record.forfeitWinner === record.side) summary.wins += 1;
      else summary.losses += 1;
      continue;
    }
    const own = record.side === 'HOME' ? record.homeScore : record.awayScore;
    const other = record.side === 'HOME' ? record.awayScore : record.homeScore;
    if (own > other) summary.wins += 1;
    else if (own < other) summary.losses += 1;
    else summary.draws += 1;
    summary.goals += record.goals;
    summary.assists += record.assists;
  }
  return summary;
}
