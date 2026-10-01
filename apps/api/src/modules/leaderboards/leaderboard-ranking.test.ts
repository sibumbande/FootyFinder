import { describe, expect, it } from 'vitest';
import { rankLeaderboard, saMonthStart } from './leaderboard-ranking.js';

const player = (userId: string, value: number, displayName = userId) => ({ userId, displayName, avatarUrl: null, value });

describe('leaderboard ranking (CEO batch 3.5, item 6)', () => {
  it('ranks highest first, ties share a rank (1, 2, 2, 4) listed by name, and players with 0 are left out', () => {
    const { rows } = rankLeaderboard([player('d', 1), player('b', 5, 'Zola'), player('c', 5, 'Amahle'), player('a', 9), player('e', 0)]);
    expect(rows.map(({ userId, rank }) => [userId, rank])).toEqual([['a', 1], ['c', 2], ['b', 2], ['d', 4]]);
  });

  it('shows the top 20 plus everyone tied with the 20th', () => {
    const players = [...Array.from({ length: 19 }, (_, index) => player(`p${String(index).padStart(2, '0')}`, 100 - index)), player('t1', 3), player('t2', 3), player('t3', 3), player('last', 1)];
    const { rows } = rankLeaderboard(players);
    expect(rows).toHaveLength(22);
    expect(rows.slice(-3).map(({ rank }) => rank)).toEqual([20, 20, 20]);
    expect(rows.some(({ userId }) => userId === 'last')).toBe(false);
  });

  it('returns the viewer separately only when they are ranked but not shown', () => {
    const players = [...Array.from({ length: 25 }, (_, index) => player(`p${String(index).padStart(2, '0')}`, 100 - index))];
    expect(rankLeaderboard(players, 'p24').viewer).toMatchObject({ userId: 'p24', rank: 25, value: 76 });
    expect(rankLeaderboard(players, 'p03').viewer).toBeNull();
    expect(rankLeaderboard(players, 'nobody').viewer).toBeNull();
  });

  it('starts "this month" at midnight on the 1st in South African time', () => {
    expect(saMonthStart(new Date('2026-10-15T12:00:00Z')).toISOString()).toBe('2026-09-30T22:00:00.000Z');
    // 23:30 UTC on 31 October is already 1 November in Cape Town.
    expect(saMonthStart(new Date('2026-10-31T23:30:00Z')).toISOString()).toBe('2026-10-31T22:00:00.000Z');
  });
});
