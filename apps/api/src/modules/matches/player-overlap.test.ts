import { describe, expect, it } from 'vitest';
import { PlayerOverlapError, playerOverlapAppError } from './player-overlap.js';

describe('Gate 9 / TKT-908 overlap error', () => {
  const clash = { id: 'm1', name: 'Friday five-a-side', startsAt: new Date('2026-10-02T16:00:00Z'), userId: 'u1' };
  it('tells the player which match they are already in, with the Johannesburg time', () => {
    const error = playerOverlapAppError(new PlayerOverlapError(clash, true));
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('PLAYER_MATCH_OVERLAP');
    expect(error.message).toContain("You're already in another match at this time (Friday five-a-side");
    expect(error.message).toContain('18:00');
    expect(error.details).toEqual({ matchId: 'm1' });
  });
  it('speaks about the selected player when a captain picks them', () => {
    expect(playerOverlapAppError(new PlayerOverlapError(clash, false)).message).toContain('This player is already in another match');
  });
});
