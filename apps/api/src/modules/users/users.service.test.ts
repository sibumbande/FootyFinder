import { describe, expect, it, vi } from 'vitest';
import type { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';
import { aggregatePlayerStatistics, type StatisticsRecord } from './player-statistics.js';

const user = {
  id: '4a5529e6-4289-4f0a-94b7-233950def34d',
  email: 'player@example.test',
  username: 'player',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  profile: null,
};
const record = (side: 'HOME' | 'AWAY', result: Partial<StatisticsRecord>, goals = 0, assists = 0): StatisticsRecord => ({
  side,
  outcomeType: 'PLAYED',
  homeScore: 0,
  awayScore: 0,
  forfeitWinner: null,
  ...result,
  goals,
  assists,
});

describe('player statistics (TKT-211, Gate 8 / TKT-808)', () => {
  it('counts wins, draws and losses, goals and assists from played results', () => {
    expect(aggregatePlayerStatistics([
      record('HOME', { homeScore: 2, awayScore: 1 }, 2, 1),
      record('AWAY', { homeScore: 0, awayScore: 0 }),
      record('AWAY', { homeScore: 3, awayScore: 1 }, 1),
    ])).toEqual({ matchesPlayed: 3, wins: 1, draws: 1, losses: 1, goals: 3, assists: 1 });
  });

  it('counts a forfeit as a win or loss without goals, and leaves abandoned matches out (D13)', () => {
    expect(aggregatePlayerStatistics([
      record('HOME', { outcomeType: 'FORFEIT', forfeitWinner: 'HOME' }, 4, 2),
      record('HOME', { outcomeType: 'FORFEIT', forfeitWinner: 'AWAY' }),
      record('AWAY', { outcomeType: 'ABANDONED' }, 1, 1),
    ])).toEqual({ matchesPlayed: 2, wins: 1, draws: 0, losses: 1, goals: 0, assists: 0 });
  });

  it('builds the profile statistics from the repository records', async () => {
    const users = {
      findById: vi.fn().mockResolvedValue(user),
      statistics: vi.fn().mockResolvedValue([record('HOME', { homeScore: 1, awayScore: 0 }, 1, 0)]),
    };
    const result = await new UsersService(users as unknown as UsersRepository).get(user.id);
    expect(result.statistics).toEqual({ matchesPlayed: 1, wins: 1, draws: 0, losses: 0, goals: 1, assists: 0 });
  });
});
