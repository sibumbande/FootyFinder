import type {
  CancellationQuote,
  ChangeParticipantTeamInput,
  CreateMatchInput,
  DiscoveryQuery,
  FormationSlot,
  FormationSlotUpdateInput,
  JoinMatchInput,
  LobbyMessage,
  Match,
  MatchParticipant,
  ParticipantCancellationStatus,
  ResultInput,
  SendLobbyMessageInput,
  UpdateMatchInput,
} from '@footy-finder/shared';
import type { ApiClient } from './client.js';
const queryString = (query: Partial<DiscoveryQuery> = {}) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) params.set(key, String(value));
  });
  const value = params.toString();
  return value ? `?${value}` : '';
};
export const matchesApi = (client: ApiClient) => ({
  list: (query?: Partial<DiscoveryQuery>) =>
    client.request<{ data: Match[] }>(`/matches${queryString(query)}`),
  get: (id: string) => client.request<{ data: Match }>(`/matches/${id}`),
  invite: (token: string) => client.request<{ data: Match }>(`/matches/invite/${token}`),
  create: (input: CreateMatchInput) =>
    client.request<{ data: Match }>('/matches', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: UpdateMatchInput) =>
    client.request<{ data: Match }>(`/matches/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    client.request<{ data: { success: true } }>(`/matches/${id}`, { method: 'DELETE' }),
  ready: (id: string) =>
    client.request<{ data: Match }>(`/matches/${id}/ready`, { method: 'POST' }),
  join: (id: string, input: JoinMatchInput, idempotencyKey: string) =>
    client.request<{ data: MatchParticipant }>(`/matches/${id}/join`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    }),
  cancellationQuote: (id: string) =>
    client.request<{ data: CancellationQuote }>(`/matches/${id}/cancellation-quote`),
  cancellationStatus: (id: string) =>
    client.request<{ data: ParticipantCancellationStatus | null }>(
      `/matches/${id}/cancellation-status`,
    ),
  leave: (id: string) =>
    client.request<{ data: unknown }>(`/matches/${id}/leave`, { method: 'POST' }),
  formation: (id: string, slotId: string, input: FormationSlotUpdateInput) =>
    client.request<{ data: FormationSlot[] }>(`/matches/${id}/formation/slots/${slotId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  changeTeam: (id: string, participantId: string, input: ChangeParticipantTeamInput) =>
    client.request<{ data: MatchParticipant }>(
      `/matches/${id}/participants/${participantId}/team`,
      { method: 'PATCH', body: JSON.stringify(input) },
    ),
  submitResult: (id: string, input: ResultInput) =>
    client.request<{ data: Match }>(`/matches/${id}/result`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  participants: (id: string) =>
    client.request<{ data: MatchParticipant[] }>(`/matches/${id}/participants`),
  messages: (id: string) => client.request<{ data: LobbyMessage[] }>(`/matches/${id}/messages`),
  sendMessage: (id: string, input: SendLobbyMessageInput) =>
    client.request<{ data: LobbyMessage }>(`/matches/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
});
