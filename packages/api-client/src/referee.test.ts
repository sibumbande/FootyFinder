import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { refereeApi } from './referee.js';

describe('refereeApi', () => {
  it('declines an assignment (Gate 8 / D16)', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    await refereeApi({ request } as unknown as ApiClient).decline('match-id', { reason: 'Injured' });
    expect(request).toHaveBeenCalledWith('/referee/matches/match-id/decline', { method: 'POST', body: JSON.stringify({ reason: 'Injured' }) });
  });
});
