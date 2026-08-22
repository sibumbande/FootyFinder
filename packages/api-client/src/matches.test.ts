import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { matchesApi } from './matches.js';

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
