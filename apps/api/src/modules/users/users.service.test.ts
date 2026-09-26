import { describe, expect, it, vi } from 'vitest';
import type { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

const user = {
  id: '4a5529e6-4289-4f0a-94b7-233950def34d',
  email: 'player@example.test',
  username: 'player',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  profile: null,
};
const row = (team: 'HOME' | 'AWAY', result: Record<string, unknown>, goals = 0) => ({
  team,
  scoring: goals ? [{ goals }] : [],
  match: { result },
});

describe('UsersService statistics', () => {
  it('reconciles played results and forfeits without inventing forfeit goals', async () => {
    const users = {
      findById: vi.fn().mockResolvedValue(user),
      statistics: vi.fn().mockResolvedValue([
        row('HOME', { id: 'r1', homeScore: 2, awayScore: 1, outcomeType: 'PLAYED', forfeitWinner: null }, 2),
        row('AWAY', { id: 'r2', homeScore: 0, awayScore: 0, outcomeType: 'PLAYED', forfeitWinner: null }),
        row('AWAY', { id: 'r3', homeScore: 0, awayScore: 0, outcomeType: 'FORFEIT', forfeitWinner: 'HOME' }, 4),
      ]),
    };
    const result = await new UsersService(users as unknown as UsersRepository).get(user.id);
    expect(result.statistics).toEqual({ matchesPlayed: 3, wins: 1, draws: 1, losses: 1, goals: 2 });
  });
});
