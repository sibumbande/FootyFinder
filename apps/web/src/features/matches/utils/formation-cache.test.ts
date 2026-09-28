import type { FormationSlot, Match } from '@footy-finder/shared';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { applyFormationSnapshot, isFormationSnapshot, matchQueryKey } from './formation-cache.js';

const slot = (participantId: string | null): FormationSlot => ({
  id: 'slot-1',
  matchId: 'match-1',
  team: 'HOME',
  slotIndex: 1,
  positionX: 50,
  positionY: 80,
  participantId,
});

const seed = (formationVersion: number) => {
  const cache = new QueryClient();
  cache.setQueryData(matchQueryKey('match-1'), {
    id: 'match-1',
    name: 'Lobby',
    formationVersion,
    formationSlots: [slot(null)],
  } as unknown as Match);
  return cache;
};

const cached = (cache: QueryClient) => cache.getQueryData<Match>(matchQueryKey('match-1'));

describe('formation cache snapshots', () => {
  it('applies a newer committed snapshot and keeps unrelated match fields', () => {
    const cache = seed(3);
    expect(
      applyFormationSnapshot(cache, { matchId: 'match-1', formationVersion: 4, slots: [slot('p1')] }),
    ).toBe(true);
    expect(cached(cache)).toMatchObject({
      name: 'Lobby',
      formationVersion: 4,
      formationSlots: [{ participantId: 'p1' }],
    });
  });

  it('ignores duplicate and out-of-order snapshots', () => {
    const cache = seed(5);
    expect(
      applyFormationSnapshot(cache, { matchId: 'match-1', formationVersion: 5, slots: [slot('dup')] }),
    ).toBe(false);
    expect(
      applyFormationSnapshot(cache, { matchId: 'match-1', formationVersion: 2, slots: [slot('old')] }),
    ).toBe(false);
    expect(cached(cache)).toMatchObject({ formationVersion: 5, formationSlots: [{ participantId: null }] });
  });

  it('does not create a lobby entry that was never loaded', () => {
    const cache = new QueryClient();
    applyFormationSnapshot(cache, { matchId: 'match-1', formationVersion: 1, slots: [] });
    expect(cached(cache)).toBeUndefined();
  });

  it('recognises conflict details that carry an authoritative formation', () => {
    expect(isFormationSnapshot({ matchId: 'm', formationVersion: 1, slots: [] })).toBe(true);
    expect(isFormationSnapshot({ matchId: 'm' })).toBe(false);
    expect(isFormationSnapshot(undefined)).toBe(false);
  });
});
