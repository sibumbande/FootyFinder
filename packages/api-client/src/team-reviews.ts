import type {
  AdminTeamReview,
  ModerateTeamReviewInput,
  MyTeamReview,
  TeamReviewContext,
  TeamReviewInput,
  TeamReviewSummary,
} from '@footy-finder/shared';
import type { ApiClient } from './client.js';

const id = encodeURIComponent;
const json = (method: string, body?: unknown) => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** Gate 8 / TKT-809 (DEC-017): team reviews. The author is never shown publicly. */
export const teamReviewsApi = (client: ApiClient) => ({
  context: (matchId: string) => client.request<{ data: TeamReviewContext }>(`/matches/${id(matchId)}/review`),
  create: (matchId: string, input: TeamReviewInput) =>
    client.request<{ data: MyTeamReview }>(`/matches/${id(matchId)}/review`, json('POST', input)),
  update: (matchId: string, input: TeamReviewInput) =>
    client.request<{ data: MyTeamReview }>(`/matches/${id(matchId)}/review`, json('PATCH', input)),
  remove: (matchId: string) =>
    client.request<{ data: { id: string; deleted: true } }>(`/matches/${id(matchId)}/review`, json('DELETE')),
  teamSummary: (teamId: string) => client.request<{ data: TeamReviewSummary }>(`/teams/${id(teamId)}/reviews`),
  report: (teamId: string, reviewId: string) =>
    client.request<{ data: { id: string; reported: true } }>(`/teams/${id(teamId)}/reviews/${id(reviewId)}/report`, json('POST')),
  adminList: (queue: 'pending' | 'reported' | 'all' = 'pending') =>
    client.request<{ data: AdminTeamReview[] }>(`/admin/team-reviews?queue=${queue}`),
  moderate: (reviewId: string, input: ModerateTeamReviewInput) =>
    client.request<{ data: AdminTeamReview }>(`/admin/team-reviews/${id(reviewId)}/moderate`, json('POST', input)),
});
