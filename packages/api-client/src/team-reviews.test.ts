import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { teamReviewsApi } from './team-reviews.js';

describe('teamReviewsApi (Gate 8 / TKT-809)', () => {
  it('uses the review, public summary, report and moderation routes', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = teamReviewsApi({ request } as unknown as ApiClient);
    await api.context('match-1');
    await api.create('match-1', { rating: 4, text: 'Fair and friendly' });
    await api.update('match-1', { rating: 5 });
    await api.remove('match-1');
    await api.teamSummary('team-1');
    await api.report('team-1', 'review-1');
    await api.adminList('reported');
    await api.moderate('review-1', { action: 'APPROVE_TEXT' });
    expect(request.mock.calls.map(([path, init]) => `${(init as { method?: string } | undefined)?.method ?? 'GET'} ${path}`)).toEqual([
      'GET /matches/match-1/review',
      'POST /matches/match-1/review',
      'PATCH /matches/match-1/review',
      'DELETE /matches/match-1/review',
      'GET /teams/team-1/reviews',
      'POST /teams/team-1/reviews/review-1/report',
      'GET /admin/team-reviews?queue=reported',
      'POST /admin/team-reviews/review-1/moderate',
    ]);
  });
});
