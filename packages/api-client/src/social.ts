import type {
  AddAllResult,
  FriendRequestsView,
  PlayedWithView,
  Relationship,
  SocialPlayerCard,
  SocialSettings,
  SocialSummary,
} from '@footy-finder/shared';
import type { ApiClient } from './client.js';

const id = encodeURIComponent;
const json = (method: string, body?: unknown) => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** Gate 9 / TKT-901: friends, requests, Discover and "Players you played with". */
export const socialApi = (client: ApiClient) => ({
  summary: () => client.request<{ data: SocialSummary }>('/social/summary'),
  search: (q?: string, cityId?: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (cityId) params.set('cityId', cityId);
    const query = params.toString();
    return client.request<{ data: SocialPlayerCard[] }>(`/social/search${query ? `?${query}` : ''}`);
  },
  relationships: (userIds: string[]) =>
    client.request<{ data: Relationship[] }>(`/social/relationships?userIds=${userIds.map(id).join(',')}`),
  friends: () => client.request<{ data: SocialPlayerCard[] }>('/social/friends'),
  removeFriend: (userId: string) => client.request<{ data: Relationship }>(`/social/friends/${id(userId)}`, json('DELETE')),
  requests: () => client.request<{ data: FriendRequestsView }>('/social/friend-requests'),
  sendRequest: (userId: string) => client.request<{ data: Relationship }>('/social/friend-requests', json('POST', { userId })),
  acceptRequest: (requestId: string) => client.request<{ data: Relationship }>(`/social/friend-requests/${id(requestId)}/accept`, json('POST')),
  declineRequest: (requestId: string) => client.request<{ data: Relationship }>(`/social/friend-requests/${id(requestId)}/decline`, json('POST')),
  cancelRequest: (requestId: string) => client.request<{ data: Relationship }>(`/social/friend-requests/${id(requestId)}/cancel`, json('POST')),
  settings: () => client.request<{ data: SocialSettings }>('/social/settings'),
  updateSettings: (input: SocialSettings) => client.request<{ data: SocialSettings }>('/social/settings', json('PUT', input)),
  playedWith: (matchId: string) => client.request<{ data: PlayedWithView }>(`/social/matches/${id(matchId)}/played-with`),
  addAll: (matchId: string) => client.request<{ data: AddAllResult }>(`/social/matches/${id(matchId)}/add-all`, json('POST')),
  blocks: () => client.request<{ data: SocialPlayerCard[] }>('/social/blocks'),
  block: (userId: string) => client.request<{ data: { userId: string; blocked: boolean } }>('/social/blocks', json('POST', { userId })),
  unblock: (userId: string) => client.request<{ data: { userId: string; blocked: boolean } }>(`/social/blocks/${id(userId)}`, json('DELETE')),
});
