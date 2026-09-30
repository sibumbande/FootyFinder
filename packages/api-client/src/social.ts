import type {
  AddAllResult,
  InvitableFriend,
  TeamMemberInviteSource,
  TeamMemberInviteView,
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
  myTeamInvites: () => client.request<{ data: TeamMemberInviteView[] }>('/social/team-invites'),
  acceptTeamInvite: (inviteId: string) => client.request<{ data: { inviteId: string; status: string; teamId: string } }>(`/social/team-invites/${id(inviteId)}/accept`, json('POST')),
  declineTeamInvite: (inviteId: string) => client.request<{ data: { inviteId: string; status: string; teamId: string } }>(`/social/team-invites/${id(inviteId)}/decline`, json('POST')),
  teamMemberInvites: (teamId: string) => client.request<{ data: TeamMemberInviteView[] }>(`/teams/${id(teamId)}/member-invites`),
  invitableFriends: (teamId: string) => client.request<{ data: InvitableFriend[] }>(`/teams/${id(teamId)}/invitable-friends`),
  inviteToTeam: (teamId: string, userId: string, source: TeamMemberInviteSource = 'FRIEND') =>
    client.request<{ data: TeamMemberInviteView }>(`/teams/${id(teamId)}/member-invites`, json('POST', { userId, source })),
  cancelTeamInvite: (teamId: string, inviteId: string) =>
    client.request<{ data: { inviteId: string; status: string } }>(`/teams/${id(teamId)}/member-invites/${id(inviteId)}/cancel`, json('POST')),
  unblock: (userId: string) => client.request<{ data: { userId: string; blocked: boolean } }>(`/social/blocks/${id(userId)}`, json('DELETE')),
});
