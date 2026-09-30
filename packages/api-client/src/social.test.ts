import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { socialApi } from './social.js';

describe('socialApi (Gate 9 / TKT-901)', () => {
  it('uses the friends, requests, search and played-with routes', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = socialApi({ request } as unknown as ApiClient);
    await api.summary();
    await api.search('thabo');
    await api.search();
    await api.relationships(['u1', 'u2']);
    await api.friends();
    await api.removeFriend('u1');
    await api.requests();
    await api.sendRequest('u2');
    await api.acceptRequest('r1');
    await api.declineRequest('r1');
    await api.cancelRequest('r1');
    await api.settings();
    await api.updateSettings({ friendRequestsEnabled: false });
    await api.playedWith('m1');
    await api.addAll('m1');
    expect(request.mock.calls.map(([path, init]) => `${(init as { method?: string } | undefined)?.method ?? 'GET'} ${path}`)).toEqual([
      'GET /social/summary',
      'GET /social/search?q=thabo',
      'GET /social/search',
      'GET /social/relationships?userIds=u1,u2',
      'GET /social/friends',
      'DELETE /social/friends/u1',
      'GET /social/friend-requests',
      'POST /social/friend-requests',
      'POST /social/friend-requests/r1/accept',
      'POST /social/friend-requests/r1/decline',
      'POST /social/friend-requests/r1/cancel',
      'GET /social/settings',
      'PUT /social/settings',
      'GET /social/matches/m1/played-with',
      'POST /social/matches/m1/add-all',
    ]);
  });
});
