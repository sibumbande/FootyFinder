import { createDefaultFormation, getMatchFormatConfig } from '@footy-finder/shared';
import { describe, expect, it, vi } from 'vitest';
import type { MatchesRepository } from './matches.repository.js';
import { MatchesService } from './matches.service.js';

describe('match format configuration', () => {
  it.each([
    ['FIVE_A_SIDE', 5, 5, 10, 20],
    ['SEVEN_A_SIDE', 7, 5, 14, 24],
    ['ELEVEN_A_SIDE', 11, 5, 22, 32],
  ] as const)(
    '%s derives its complete capacity and formation',
    (format, playersPerTeam, reservesPerTeam, onFieldCapacity, maxParticipants) => {
      expect(getMatchFormatConfig(format)).toMatchObject({
        playersPerTeam,
        reservesPerTeam,
        onFieldCapacity,
        maxParticipants,
      });
      const slots = createDefaultFormation(format);
      expect(slots).toHaveLength(onFieldCapacity);
      expect(slots.filter(({ team }) => team === 'HOME')).toHaveLength(playersPerTeam);
      expect(slots.filter(({ team }) => team === 'AWAY')).toHaveLength(playersPerTeam);
    },
  );
});

describe('host permissions', () => {
  it('prevents a non-host from cancelling a match', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue({ id: 'match-1', createdById: 'host-1' }),
      cancelMatch: vi.fn(),
    } as unknown as MatchesRepository;
    await expect(
      new MatchesService(repository).remove('match-1', 'player-1'),
    ).rejects.toMatchObject({ statusCode: 403, code: 'HOST_REQUIRED' });
    expect(repository.cancelMatch).not.toHaveBeenCalled();
  });
});
