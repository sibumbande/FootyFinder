import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { refereeApi } from './referee.js';

describe('refereeApi', () => {
  it('declines an assignment (Gate 8 / D16)', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    await refereeApi({ request } as unknown as ApiClient).decline('match-id', { reason: 'Injured' });
    expect(request).toHaveBeenCalledWith('/referee/matches/match-id/decline', { method: 'POST', body: JSON.stringify({ reason: 'Injured' }) });
  });

  it('reads my matches and one match (Gate 8 / TKT-805)', async () => {
    const request = vi.fn().mockResolvedValue({ data: [] });
    const api = refereeApi({ request } as unknown as ApiClient);
    await api.matches();
    await api.match('match-id');
    expect(request.mock.calls.map(([path]) => path)).toEqual(['/referee/matches', '/referee/matches/match-id']);
  });

  it('records the final result (Gate 8 / TKT-804)', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const input = { outcome: 'PLAYED' as const, homeScore: 1, awayScore: 0, goals: [{ side: 'HOME' as const, ownGoal: true }], didNotPlayUserIds: [] };
    await refereeApi({ request } as unknown as ApiClient).submitResult('match-id', input);
    expect(request).toHaveBeenCalledWith('/referee/matches/match-id/result', { method: 'POST', body: JSON.stringify(input) });
  });
});
