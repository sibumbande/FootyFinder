import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { publicApi } from './public.js';

describe('publicApi (Gate 9 / TKT-910)', () => {
  it('uses only the guest-safe /public routes', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = publicApi({ request } as unknown as ApiClient);
    await api.matches('FIVE_A_SIDE');
    await api.team('t1');
    await api.player('u1');
    await api.recruitmentPosts({ position: 'GOALKEEPER' });
    await api.lookingPlayers();
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/public/matches?format=FIVE_A_SIDE',
      '/public/teams/t1',
      '/public/players/u1',
      '/public/recruitment/posts?position=GOALKEEPER',
      '/public/recruitment/looking',
    ]);
  });
});

describe('publicApi leaderboards (CEO batch 3.5, item 6)', () => {
  it('asks for one board and period', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    await publicApi({ request } as unknown as ApiClient).leaderboard('goals', 'month');
    expect(request).toHaveBeenCalledWith('/public/leaderboards?board=goals&period=month');
  });
});
