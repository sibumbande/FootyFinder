import type { Conversation, DirectMessage, SendDirectMessageInput } from '@footy-finder/shared';
import type { ApiClient } from './client.js';
export const messagingApi = (client: ApiClient) => ({
  list: () => client.request<{ data: Conversation[] }>('/conversations'),
  start: (userId: string) =>
    client.request<{ data: Conversation }>('/conversations', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),
  get: (id: string) => client.request<{ data: Conversation }>(`/conversations/${id}`),
  send: (id: string, input: SendDirectMessageInput) =>
    client.request<{ data: DirectMessage }>(`/conversations/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  markRead: (id: string) =>
    client.request<{ data: { success: true } }>(`/conversations/${id}/read`, { method: 'POST' }),
});
