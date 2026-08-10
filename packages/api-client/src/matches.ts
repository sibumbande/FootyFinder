import type { CreateMatchInput, Match, MatchParticipant, UpdateMatchInput } from '@footy-finder/shared';
import type { ApiClient } from './client.js';
export const matchesApi = (client: ApiClient) => ({
  list: () => client.request<{ data: Match[] }>('/matches'),
  get: (id: string) => client.request<{ data: Match }>(`/matches/${id}`),
  create: (input: CreateMatchInput) => client.request<{ data: Match }>('/matches', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: UpdateMatchInput) => client.request<{ data: Match }>(`/matches/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (id: string) => client.request<{ data: { success: true } }>(`/matches/${id}`, { method: 'DELETE' }),
  join: (id: string) => client.request<{ data: MatchParticipant }>(`/matches/${id}/join`, { method: 'POST' }),
  leave: (id: string) => client.request<{ data: { success: true } }>(`/matches/${id}/leave`, { method: 'POST' }),
  participants: (id: string) => client.request<{ data: MatchParticipant[] }>(`/matches/${id}/participants`),
});
