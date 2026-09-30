import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { recruitmentApi } from './recruitment.js';

describe('recruitmentApi (Gate 9 / TKT-909)', () => {
  it('uses the board, looking card, join request and admin routes', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = recruitmentApi({ request } as unknown as ApiClient);
    const post = { positions: ['GOALKEEPER' as const], playersWanted: 1, format: 'FIVE_A_SIDE' as const, level: 'CASUAL' as const, days: [], times: [], area: 'Woodstock' };
    await api.posts({ format: 'FIVE_A_SIDE', position: 'GOALKEEPER' });
    await api.looking();
    await api.myCard();
    await api.updateMyCard({ enabled: false, positions: [], days: [], times: [] });
    await api.askToJoin('p1');
    await api.myJoinRequests();
    await api.cancelJoinRequest('r1');
    await api.teamPosts('t1');
    await api.createPost('t1', post);
    await api.updatePost('t1', 'p1', post);
    await api.renewPost('t1', 'p1');
    await api.closePost('t1', 'p1');
    await api.teamJoinRequests('t1');
    await api.acceptJoinRequest('t1', 'r1');
    await api.declineJoinRequest('t1', 'r1');
    await api.adminList('POST', 'all');
    await api.adminRemovePost('p1', 'Spam post');
    await api.adminRemoveCard('c1', 'Abusive note');
    expect(request.mock.calls.map(([path, init]) => `${(init as { method?: string } | undefined)?.method ?? 'GET'} ${path}`)).toEqual([
      'GET /social/recruitment/posts?format=FIVE_A_SIDE&position=GOALKEEPER',
      'GET /social/recruitment/looking',
      'GET /social/looking-card',
      'PUT /social/looking-card',
      'POST /social/recruitment/posts/p1/join-requests',
      'GET /social/join-requests',
      'POST /social/join-requests/r1/cancel',
      'GET /teams/t1/recruitment-posts',
      'POST /teams/t1/recruitment-posts',
      'PATCH /teams/t1/recruitment-posts/p1',
      'POST /teams/t1/recruitment-posts/p1/renew',
      'POST /teams/t1/recruitment-posts/p1/close',
      'GET /teams/t1/join-requests',
      'POST /teams/t1/join-requests/r1/accept',
      'POST /teams/t1/join-requests/r1/decline',
      'GET /admin/recruitment?queue=all&kind=POST',
      'POST /admin/recruitment/posts/p1/remove',
      'POST /admin/recruitment/cards/c1/remove',
    ]);
  });
});
