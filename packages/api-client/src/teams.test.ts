import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { teamsApi } from './teams.js';

describe('teamsApi formation contract', () => {
  it('uses PUT when replacing a Team formation preset', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = teamsApi({ request } as unknown as ApiClient);

    await api.saveFormation('team-1', 'FIVE_A_SIDE', {
      formationKey: 'BALANCED_1_1_2_1',
    });

    expect(request).toHaveBeenCalledWith('/teams/team-1/formations/FIVE_A_SIDE', {
      method: 'PUT',
      body: JSON.stringify({ formationKey: 'BALANCED_1_1_2_1' }),
    });
  });
});
