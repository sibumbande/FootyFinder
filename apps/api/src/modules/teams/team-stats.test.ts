import { describe, expect, it } from 'vitest';
import { aggregateTeamStats, type TeamResultRow } from './team-stats.js';

const row = (day: number, side: 'HOME' | 'AWAY', homeScore: number, awayScore: number, extra: Partial<TeamResultRow> = {}): TeamResultRow => ({
  matchId: `m${day}`, startsAt: new Date(`2026-09-${String(day).padStart(2, '0')}T16:00:00Z`), side, opponent: `Opponent ${day}`,
  outcomeType: 'PLAYED', homeScore, awayScore, forfeitWinner: null, ...extra,
});

describe('team statistics (CEO batch 4, item 2)', () => {
  it('counts played, W/D/L, goals for and against and goal difference from either side', () => {
    const stats = aggregateTeamStats([row(1, 'HOME', 3, 1), row(2, 'AWAY', 2, 2), row(3, 'AWAY', 4, 0)]);
    expect(stats).toMatchObject({ played: 3, wins: 1, draws: 1, losses: 1, goalsFor: 5, goalsAgainst: 7, goalDifference: -2 });
  });

  it('counts a forfeit as a win or loss with no goals, and skips abandoned matches', () => {
    const stats = aggregateTeamStats([
      row(1, 'HOME', 0, 0, { outcomeType: 'FORFEIT', forfeitWinner: 'HOME' }),
      row(2, 'AWAY', 0, 0, { outcomeType: 'FORFEIT', forfeitWinner: 'HOME' }),
      row(3, 'HOME', 5, 0, { outcomeType: 'ABANDONED' }),
    ]);
    expect(stats).toMatchObject({ played: 2, wins: 1, losses: 1, goalsFor: 0, goalsAgainst: 0 });
    expect(stats.lastFive.every(({ forfeit }) => forfeit)).toBe(true);
  });

  it('keeps the last five results, newest first', () => {
    const stats = aggregateTeamStats([1, 2, 3, 4, 5, 6, 7].map((day) => row(day, 'HOME', day % 2, 0)));
    expect(stats.lastFive.map(({ matchId }) => matchId)).toEqual(['m7', 'm6', 'm5', 'm4', 'm3']);
    expect(stats.lastFive.map(({ outcome }) => outcome)).toEqual(['W', 'D', 'W', 'D', 'W']);
  });
});
