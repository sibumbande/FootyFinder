import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { matchesApi } from './matches.js';

describe('matchesApi discovery', () => {
  it('preserves availableOnly=false in the query contract', async () => {
    const request = vi.fn().mockResolvedValue({ data: [] });
    const api = matchesApi({ request } as unknown as ApiClient);

    await api.list({ availableOnly: false });

    expect(request).toHaveBeenCalledWith('/matches?availableOnly=false');
  });
});

describe('matchesApi invitation rotation', () => {
  it('uses the authenticated one-time invitation endpoint', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = matchesApi({ request } as unknown as ApiClient);
    await api.rotateInvite('match-1');
    expect(request).toHaveBeenCalledWith('/matches/match-1/invite', { method: 'POST' });
  });
});

describe('matchesApi public sharing', () => {
  it('uses separate anonymous-preview and authenticated-resolution endpoints', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = matchesApi({ request } as unknown as ApiClient);

    await api.publicPreview('m-0123456789abcdef01234567');
    await api.getByPublicSlug('m-0123456789abcdef01234567');

    expect(request).toHaveBeenNthCalledWith(
      1,
      '/public/matches/m-0123456789abcdef01234567',
    );
    expect(request).toHaveBeenNthCalledWith(2, '/matches/public/m-0123456789abcdef01234567');
  });
});

describe('matchesApi Team availability', () => {
  it('encodes strict availability filters including selected=false', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = matchesApi({ request } as unknown as ApiClient);

    await api.availability('match-1', 'HOME', {
      availability: 'NO_RESPONSE',
      selected: false,
    });

    expect(request).toHaveBeenCalledWith(
      '/matches/match-1/team-sides/HOME/availability?availability=NO_RESPONSE&selected=false',
    );
  });

  it('uses the request and own-response endpoints', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = matchesApi({ request } as unknown as ApiClient);

    await api.requestAvailability('match-1', 'AWAY');
    await api.updateMyAvailability('match-1', 'AWAY', { status: 'MAYBE' });

    expect(request).toHaveBeenNthCalledWith(
      1,
      '/matches/match-1/team-sides/AWAY/availability/request',
      { method: 'POST' },
    );
    expect(request).toHaveBeenNthCalledWith(2, '/matches/match-1/team-sides/AWAY/availability/me', {
      method: 'PUT',
      body: JSON.stringify({ status: 'MAYBE' }),
    });
  });
});

describe('matchesApi Team lineup', () => {
  it('uses typed lineup assignment, movement, claim, and finalization routes', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = matchesApi({ request } as unknown as ApiClient);
    await api.assignLineupStarter('match-1', 'HOME', 'slot-1', {
      userId: '11111111-1111-4111-8111-111111111111',
      displacedPlayerAction: 'BENCH',
    });
    await api.moveLineupSlot('match-1', 'HOME', 'slot-1', {
      positionX: 40,
      positionY: 70,
    });
    await api.claimLineupSlot('match-1', 'HOME', 'slot-1');
    await api.finalizeLineup('match-1', 'HOME');
    expect(request).toHaveBeenNthCalledWith(
      1,
      '/matches/match-1/team-sides/HOME/lineup/slots/slot-1/player',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/matches/match-1/team-sides/HOME/lineup/slots/slot-1/position',
      { method: 'PATCH', body: JSON.stringify({ positionX: 40, positionY: 70 }) },
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      '/matches/match-1/team-sides/HOME/lineup/slots/slot-1/claim',
      { method: 'POST' },
    );
    expect(request).toHaveBeenNthCalledWith(4, '/matches/match-1/team-sides/HOME/lineup/finalize', {
      method: 'POST',
    });
  });

  it('uses PUT for every lineup endpoint that replaces selection state', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = matchesApi({ request } as unknown as ApiClient);

    await api.inviteLineupPlayer('match-1', 'HOME', 'user-1');
    await api.selectLineupSubstitute('match-1', 'HOME', 'user-1');

    expect(request).toHaveBeenNthCalledWith(
      1,
      '/matches/match-1/team-sides/HOME/lineup/selections/user-1/invite',
      { method: 'PUT' },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/matches/match-1/team-sides/HOME/lineup/substitutes/user-1',
      { method: 'PUT' },
    );
  });
});

describe('matchesApi Gate 8 result evidence (TKT-806)', () => {
  it('reads the result context, sends an own version and reports a problem', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = matchesApi({ request } as unknown as ApiClient);
    await api.resultContext('match-1');
    await api.submitResultVersion('match-1', { outcome: 'PLAYED', homeScore: 2, awayScore: 1, goals: [] });
    await api.reportResultProblem('match-1', { message: 'The first goal was scored by Ann.' });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/matches/match-1/result-context',
      '/matches/match-1/result-version',
      '/matches/match-1/result-problems',
    ]);
    expect(request.mock.calls[2]![1]).toMatchObject({ method: 'POST' });
  });
});
