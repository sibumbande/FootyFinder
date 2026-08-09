import type { CreateMatchInput, Match } from '@footy-finder/shared';
import type { ApiClient } from './client.js';
export const matchesApi = (client: ApiClient) => ({ list: () => client.request<{ data: Match[] }>('/matches'), get: (id: string) => client.request<{ data: Match }>(`/matches/${id}`), create: (input: CreateMatchInput) => client.request<{ data: Match }>('/matches', { method: 'POST', body: JSON.stringify(input) }), join: (id: string) => client.request(`/matches/${id}/join`, { method: 'POST' }), leave: (id: string) => client.request(`/matches/${id}/leave`, { method: 'POST' }) });
