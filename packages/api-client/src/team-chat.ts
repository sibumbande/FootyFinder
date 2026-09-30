import type { TeamChatMessage, TeamChatPage } from '@footy-finder/shared';
import type { ApiClient } from './client.js';

/** Gate 7 (TKT-710/711): the team's own chat. */
export const teamChatApi = (client: ApiClient) => ({
  history: (teamId: string, params: { before?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.before) search.set('before', params.before);
    if (params.limit) search.set('limit', String(params.limit));
    const query = search.toString();
    return client.request<{ data: TeamChatPage }>(`/teams/${teamId}/chat/messages${query ? `?${query}` : ''}`);
  },
  send: (teamId: string, content: string) =>
    client.request<{ data: TeamChatMessage }>(`/teams/${teamId}/chat/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  markRead: (teamId: string) =>
    client.request<{ data: { unreadCount: number } }>(`/teams/${teamId}/chat/read`, { method: 'POST' }),
});
