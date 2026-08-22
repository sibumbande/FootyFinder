import {
  createDefaultFormation,
  getMatchFormatConfig,
  getMaxMatchParticipants,
  getMaxParticipantsPerTeam,
} from '@footy-finder/shared';
import { describe, expect, it, vi } from 'vitest';
import type { MatchesRepository } from './matches.repository.js';
import { MatchesService } from './matches.service.js';

describe('match format configuration', () => {
  it.each([
    ['FIVE_A_SIDE', 5, 10],
    ['SEVEN_A_SIDE', 7, 14],
    ['ELEVEN_A_SIDE', 11, 22],
  ] as const)(
    '%s derives its starter capacity and formation',
    (format, startersPerTeam, onFieldCapacity) => {
      expect(getMatchFormatConfig(format)).toMatchObject({
        startersPerTeam,
        onFieldCapacity,
      });
      const slots = createDefaultFormation(format);
      expect(slots).toHaveLength(onFieldCapacity);
      expect(slots.filter(({ team }) => team === 'HOME')).toHaveLength(startersPerTeam);
      expect(slots.filter(({ team }) => team === 'AWAY')).toHaveLength(startersPerTeam);
    },
  );

  it.each([
    ['FIVE_A_SIDE', 5],
    ['SEVEN_A_SIDE', 7],
    ['ELEVEN_A_SIDE', 11],
  ] as const)('%s derives capacity for 0, 5 and 10 substitutes', (format, startersPerTeam) => {
    for (const substitutes of [0, 5, 10]) {
      expect(getMaxParticipantsPerTeam(format, substitutes)).toBe(startersPerTeam + substitutes);
      expect(getMaxMatchParticipants(format, substitutes)).toBe(
        (startersPerTeam + substitutes) * 2,
      );
    }
  });
});

describe('host permissions', () => {
  it('prevents a non-host from cancelling a match', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue({
        id: 'match-1',
        mode: 'QUICK_GAME',
        createdById: 'host-1',
      }),
      cancelMatch: vi.fn(),
    } as unknown as MatchesRepository;
    await expect(
      new MatchesService(repository).remove('match-1', 'player-1'),
    ).rejects.toMatchObject({ statusCode: 403, code: 'HOST_REQUIRED' });
    expect(repository.cancelMatch).not.toHaveBeenCalled();
  });

  it('uses current Team roles instead of Quick Game host authority for Team fixtures', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue({
        id: 'match-1',
        mode: 'TEAM_MATCH',
        createdById: 'captain-1',
      }),
      findAttachedTeamMembership: vi.fn().mockResolvedValue({ role: 'MEMBER' }),
      cancelMatch: vi.fn(),
    } as unknown as MatchesRepository;
    await expect(
      new MatchesService(repository).remove('match-1', 'member-1'),
    ).rejects.toMatchObject({ statusCode: 403, code: 'TEAM_FORBIDDEN' });
    expect(repository.cancelMatch).not.toHaveBeenCalled();
  });
});
