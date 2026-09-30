import type {
  AdminRecruitmentItem,
  LookingCardInput,
  LookingCardView,
  MyLookingCard,
  RecruitmentPostInput,
  RecruitmentPostView,
  TeamJoinRequestView,
} from '@footy-finder/shared';
import type { ApiClient } from './client.js';

const id = encodeURIComponent;
const json = (method: string, body?: unknown) => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export type RecruitmentFilters = { format?: string; level?: string; position?: string; area?: string; q?: string };
const query = (filters: RecruitmentFilters = {}) => {
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)) as Array<[string, string]>);
  const text = params.toString();
  return text ? `?${text}` : '';
};

/** Gate 9 / TKT-909: the team recruitment board. */
export const recruitmentApi = (client: ApiClient) => ({
  posts: (filters?: RecruitmentFilters) => client.request<{ data: RecruitmentPostView[] }>(`/social/recruitment/posts${query(filters)}`),
  looking: (filters?: RecruitmentFilters) => client.request<{ data: LookingCardView[] }>(`/social/recruitment/looking${query(filters)}`),
  myCard: () => client.request<{ data: MyLookingCard }>('/social/looking-card'),
  updateMyCard: (input: LookingCardInput) => client.request<{ data: MyLookingCard }>('/social/looking-card', json('PUT', input)),
  askToJoin: (postId: string) => client.request<{ data: TeamJoinRequestView }>(`/social/recruitment/posts/${id(postId)}/join-requests`, json('POST')),
  myJoinRequests: () => client.request<{ data: TeamJoinRequestView[] }>('/social/join-requests'),
  cancelJoinRequest: (requestId: string) => client.request<{ data: { requestId: string; status: string } }>(`/social/join-requests/${id(requestId)}/cancel`, json('POST')),
  teamPosts: (teamId: string) => client.request<{ data: RecruitmentPostView[] }>(`/teams/${id(teamId)}/recruitment-posts`),
  createPost: (teamId: string, input: RecruitmentPostInput) =>
    client.request<{ data: RecruitmentPostView }>(`/teams/${id(teamId)}/recruitment-posts`, json('POST', input)),
  updatePost: (teamId: string, postId: string, input: RecruitmentPostInput) =>
    client.request<{ data: RecruitmentPostView }>(`/teams/${id(teamId)}/recruitment-posts/${id(postId)}`, json('PATCH', input)),
  renewPost: (teamId: string, postId: string) =>
    client.request<{ data: RecruitmentPostView }>(`/teams/${id(teamId)}/recruitment-posts/${id(postId)}/renew`, json('POST')),
  closePost: (teamId: string, postId: string) =>
    client.request<{ data: RecruitmentPostView }>(`/teams/${id(teamId)}/recruitment-posts/${id(postId)}/close`, json('POST')),
  teamJoinRequests: (teamId: string) => client.request<{ data: TeamJoinRequestView[] }>(`/teams/${id(teamId)}/join-requests`),
  acceptJoinRequest: (teamId: string, requestId: string) =>
    client.request<{ data: { requestId: string; status: string } }>(`/teams/${id(teamId)}/join-requests/${id(requestId)}/accept`, json('POST')),
  declineJoinRequest: (teamId: string, requestId: string) =>
    client.request<{ data: { requestId: string; status: string } }>(`/teams/${id(teamId)}/join-requests/${id(requestId)}/decline`, json('POST')),
  adminList: (kind?: 'POST' | 'CARD', queue: 'reported' | 'all' = 'reported') =>
    client.request<{ data: AdminRecruitmentItem[] }>(`/admin/recruitment?queue=${queue}${kind ? `&kind=${kind}` : ''}`),
  adminRemovePost: (postId: string, reason: string) =>
    client.request<{ data: { id: string; removed: true } }>(`/admin/recruitment/posts/${id(postId)}/remove`, json('POST', { reason })),
  adminRemoveCard: (cardId: string, reason: string) =>
    client.request<{ data: { id: string; removed: true } }>(`/admin/recruitment/cards/${id(cardId)}/remove`, json('POST', { reason })),
});
