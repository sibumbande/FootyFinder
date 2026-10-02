import { describe, expect, it } from 'vitest';
import { rankLeaderboard, saMonthStart, type LeaderboardCandidate } from './leaderboard-ranking.js';

const day = (n: number) => new Date(Date.UTC(2026, 8, n));
const player = (userId: string, stats: Partial<Pick<LeaderboardCandidate, 'matches' | 'goals' | 'assists'>>, reached = 1, joined = 1): LeaderboardCandidate => ({
  userId,
  displayName: userId,
  avatarUrl: null,
  matches: stats.matches ?? 0,
  goals: stats.goals ?? 0,
  assists: stats.assists ?? 0,
  reachedAt: { matches: day(reached), goals: day(reached), assists: day(reached) },
  joinedAt: day(joined),
});
const order = (result: ReturnType<typeof rankLeaderboard>) => result.rows.map(({ userId, rank }) => `${rank}:${userId}`);

describe('leaderboard ranking (batch 5 brief, B3; CEO D16)', () => {
  it('most matches: matches, then goals + assists, then whoever got there first; always 1, 2, 3', () => {
    const players = [
      player('late', { matches: 5, goals: 1 }, 20),
      player('early', { matches: 5, goals: 1 }, 10),
      player('scorer', { matches: 5, goals: 2, assists: 1 }),
      player('top', { matches: 7 }),
      player('none', { goals: 3 }),
    ];
    expect(order(rankLeaderboard(players, 'matches'))).toEqual(['1:top', '2:scorer', '3:early', '4:late']);
  });

  it('most goals: goals, then fewer matches, then assists, then reached first', () => {
    const players = [
      player('busy', { goals: 4, matches: 6 }),
      player('efficient', { goals: 4, matches: 3 }),
      player('creator', { goals: 4, matches: 3, assists: 2 }),
      player('later', { goals: 2, matches: 1 }, 15),
      player('sooner', { goals: 2, matches: 1 }, 5),
    ];
    expect(order(rankLeaderboard(players, 'goals'))).toEqual(['1:creator', '2:efficient', '3:busy', '4:sooner', '5:later']);
  });

  it('most assists: assists, then fewer matches, then goals', () => {
    const players = [player('a', { assists: 3, matches: 4 }), player('b', { assists: 3, matches: 2 }), player('c', { assists: 3, matches: 2, goals: 1 })];
    expect(order(rankLeaderboard(players, 'assists'))).toEqual(['1:c', '2:b', '3:a']);
  });

  it('a truly identical record goes to whoever joined FootyFinder first', () => {
    const players = [player('newer', { goals: 1, matches: 1 }, 3, 9), player('older', { goals: 1, matches: 1 }, 3, 2)];
    expect(order(rankLeaderboard(players, 'goals'))).toEqual(['1:older', '2:newer']);
  });

  it('shows the top 10 and returns the viewer separately only when they are ranked but not shown', () => {
    const players = Array.from({ length: 14 }, (_, index) => player(`p${String(index).padStart(2, '0')}`, { matches: 30 - index }));
    expect(rankLeaderboard(players, 'matches').rows).toHaveLength(10);
    expect(rankLeaderboard(players, 'matches', 'p13').viewer).toMatchObject({ userId: 'p13', rank: 14, value: 17 });
    expect(rankLeaderboard(players, 'matches', 'p03').viewer).toBeNull();
    expect(rankLeaderboard(players, 'matches', 'nobody').viewer).toBeNull();
  });

  it('starts "this month" at midnight on the 1st in South African time', () => {
    expect(saMonthStart(new Date('2026-10-15T12:00:00Z')).toISOString()).toBe('2026-09-30T22:00:00.000Z');
    // 23:30 UTC on 31 October is already 1 November in Cape Town.
    expect(saMonthStart(new Date('2026-10-31T23:30:00Z')).toISOString()).toBe('2026-10-31T22:00:00.000Z');
  });
});
