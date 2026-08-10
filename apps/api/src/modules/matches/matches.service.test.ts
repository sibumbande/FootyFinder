import type { MatchParticipant } from '@footy-finder/shared';
import { describe, expect, it, vi } from 'vitest';
import type { MatchesRepository } from './matches.repository.js';
import { findNextSlot, MatchesService } from './matches.service.js';

const participant = (team: 'HOME' | 'AWAY', squadRole: 'STARTER' | 'RESERVE', slotNumber: number) => ({ team, squadRole, slotNumber }) satisfies Pick<MatchParticipant, 'team' | 'squadRole' | 'slotNumber'>;

describe('match slot allocation', () => {
  it('balances starters across both teams', () => {
    expect(findNextSlot([])).toEqual({ team: 'HOME', squadRole: 'STARTER', slotNumber: 1 });
    expect(findNextSlot([participant('HOME', 'STARTER', 1)])).toEqual({ team: 'AWAY', squadRole: 'STARTER', slotNumber: 1 });
  });

  it('moves to reserve slots after twenty starters', () => {
    const starters = (['HOME', 'AWAY'] as const).flatMap((team) => Array.from({ length: 10 }, (_, index) => participant(team, 'STARTER', index + 1)));
    expect(findNextSlot(starters)).toEqual({ team: 'HOME', squadRole: 'RESERVE', slotNumber: 1 });
  });

  it('returns no slot after all thirty places are occupied', () => {
    const fullSquad = (['HOME', 'AWAY'] as const).flatMap((team) => [
      ...Array.from({ length: 10 }, (_, index) => participant(team, 'STARTER', index + 1)),
      ...Array.from({ length: 5 }, (_, index) => participant(team, 'RESERVE', index + 1)),
    ]);
    expect(findNextSlot(fullSquad)).toBeNull();
  });
});

describe('host permissions', () => {
  it('prevents a non-host from deleting a lobby', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue({ id: 'match-1', createdById: 'host-1' }),
      remove: vi.fn(),
    } as unknown as MatchesRepository;
    await expect(new MatchesService(repository).remove('match-1', 'player-1')).rejects.toMatchObject({ statusCode: 403, code: 'HOST_REQUIRED' });
    expect(repository.remove).not.toHaveBeenCalled();
  });
});
