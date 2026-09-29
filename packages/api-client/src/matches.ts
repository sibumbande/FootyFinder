import type {
  CancellationQuote,
  ChangeParticipantTeamInput,
  CreateMatchInput,
  DiscoveryQuery,
  FormationSlot,
  FormationSlotUpdateInput,
  FormationSnapshot,
  JoinMatchInput,
  LobbyMessage,
  Match,
  MatchParticipant,
  PublicMatchPreview,
  ParticipantCancellationStatus,
  ResultInput,
  SendLobbyMessageInput,
  TeamMatchAvailabilityQuery,
  TeamMatchAvailabilityRequestResult,
  TeamMatchAvailabilityResponse,
  TeamMatchAvailabilityRow,
  TeamSide,
  UpdateMyTeamMatchAvailabilityInput,
  UpdateMatchInput,
  AssignTeamMatchStarterInput,
  OpenTeamMatchLineupSlotInput,
  RemoveTeamMatchStarterInput,
  TeamFormation,
  TeamMatchLineup,
  UpdateTeamMatchLineupSlotPositionInput,
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
const availabilityQueryString = (query: Partial<TeamMatchAvailabilityQuery> = {}) => {
  const params = new URLSearchParams();
  if (query.availability !== undefined) params.set('availability', query.availability);
  if (query.selected !== undefined) params.set('selected', String(query.selected));
  const value = params.toString();
  return value ? `?${value}` : '';
};
export const matchesApi = (client: ApiClient) => ({
  publicPreview: (slug: string) =>
    client.request<{ data: PublicMatchPreview }>(
      `/public/matches/${encodeURIComponent(slug)}`,
    ),
  list: (query?: Partial<DiscoveryQuery>) =>
    client.request<{ data: Match[] }>(`/matches${queryString(query)}`),
  get: (id: string) => client.request<{ data: Match }>(`/matches/${id}`),
  getByPublicSlug: (slug: string) =>
    client.request<{ data: Match }>(`/matches/public/${encodeURIComponent(slug)}`),
  invite: (token: string) => client.request<{ data: Match }>(`/matches/invite/${token}`),
  create: (input: CreateMatchInput) =>
    client.request<{ data: Match }>('/matches', { method: 'POST', body: JSON.stringify(input) }),
  rotateInvite: (id: string) =>
    client.request<{ data: Match }>(`/matches/${id}/invite`, { method: 'POST' }),
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
  /** Gate 7: load your whole team into the other side of a team match (first come, first served). */
  loadTeam: (id: string, input: { teamId: string; substituteCount: number }) =>
    client.request<{ data: Match }>(`/matches/${id}/other-side/team`, { method: 'POST', body: JSON.stringify(input) }),
  /** Gate 7 / N5: the team that took the other side withdraws itself before T-30. */
  withdrawTeam: (id: string) =>
    client.request<{ data: { releasedCents: number } }>(`/matches/${id}/other-side/team/withdraw`, { method: 'POST' }),
  leave: (id: string) =>
    client.request<{ data: unknown }>(`/matches/${id}/leave`, { method: 'POST' }),
  formation: (id: string, slotId: string, input: FormationSlotUpdateInput) =>
    client.request<{ data: FormationSlot[] }>(`/matches/${id}/formation/slots/${slotId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  claimPosition: (id: string, slotId: string) =>
    client.request<{ data: FormationSnapshot }>(
      `/matches/${id}/formation/slots/${slotId}/claim`,
      { method: 'POST' },
    ),
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
  requestAvailability: (id: string, side: TeamSide) =>
    client.request<{ data: TeamMatchAvailabilityRequestResult }>(
      `/matches/${id}/team-sides/${side}/availability/request`,
      { method: 'POST' },
    ),
  availability: (id: string, side: TeamSide, query?: Partial<TeamMatchAvailabilityQuery>) =>
    client.request<{ data: TeamMatchAvailabilityResponse }>(
      `/matches/${id}/team-sides/${side}/availability${availabilityQueryString(query)}`,
    ),
  updateMyAvailability: (id: string, side: TeamSide, input: UpdateMyTeamMatchAvailabilityInput) =>
    client.request<{ data: TeamMatchAvailabilityRow }>(
      `/matches/${id}/team-sides/${side}/availability/me`,
      { method: 'PUT', body: JSON.stringify(input) },
    ),
  lineup: (id: string, side: TeamSide) =>
    client.request<{ data: TeamMatchLineup }>(`/matches/${id}/team-sides/${side}/lineup`),
  inviteLineupPlayer: (id: string, side: TeamSide, userId: string) =>
    client.request<{ data: TeamMatchLineup }>(
      `/matches/${id}/team-sides/${side}/lineup/selections/${userId}/invite`,
      { method: 'PUT' },
    ),
  assignLineupStarter: (
    id: string,
    side: TeamSide,
    slotId: string,
    input: AssignTeamMatchStarterInput,
  ) =>
    client.request<{ data: TeamMatchLineup }>(
      `/matches/${id}/team-sides/${side}/lineup/slots/${slotId}/player`,
      { method: 'PUT', body: JSON.stringify(input) },
    ),
  removeLineupStarter: (
    id: string,
    side: TeamSide,
    slotId: string,
    input: RemoveTeamMatchStarterInput,
  ) =>
    client.request<{ data: TeamMatchLineup }>(
      `/matches/${id}/team-sides/${side}/lineup/slots/${slotId}/remove`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  openLineupSlot: (
    id: string,
    side: TeamSide,
    slotId: string,
    input: OpenTeamMatchLineupSlotInput = {},
  ) =>
    client.request<{ data: TeamMatchLineup }>(
      `/matches/${id}/team-sides/${side}/lineup/slots/${slotId}/open`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  claimLineupSlot: (id: string, side: TeamSide, slotId: string) =>
    client.request<{ data: TeamMatchLineup }>(
      `/matches/${id}/team-sides/${side}/lineup/slots/${slotId}/claim`,
      { method: 'POST' },
    ),
  moveLineupSlot: (
    id: string,
    side: TeamSide,
    slotId: string,
    input: UpdateTeamMatchLineupSlotPositionInput,
  ) =>
    client.request<{ data: TeamMatchLineup }>(
      `/matches/${id}/team-sides/${side}/lineup/slots/${slotId}/position`,
      { method: 'PATCH', body: JSON.stringify(input) },
    ),
  selectLineupSubstitute: (id: string, side: TeamSide, userId: string) =>
    client.request<{ data: TeamMatchLineup }>(
      `/matches/${id}/team-sides/${side}/lineup/substitutes/${userId}`,
      { method: 'PUT' },
    ),
  removeLineupSubstitute: (id: string, side: TeamSide, userId: string) =>
    client.request<{ data: TeamMatchLineup }>(
      `/matches/${id}/team-sides/${side}/lineup/substitutes/${userId}`,
      { method: 'DELETE' },
    ),
  declineLineupSelection: (id: string, side: TeamSide) =>
    client.request<{ data: TeamMatchLineup }>(
      `/matches/${id}/team-sides/${side}/lineup/selections/me/decline`,
      { method: 'POST' },
    ),
  finalizeLineup: (id: string, side: TeamSide) =>
    client.request<{ data: TeamMatchLineup }>(`/matches/${id}/team-sides/${side}/lineup/finalize`, {
      method: 'POST',
    }),
  saveLineupAsTeamDefault: (id: string, side: TeamSide) =>
    client.request<{ data: TeamFormation }>(
      `/matches/${id}/team-sides/${side}/lineup/save-as-team-default`,
      { method: 'POST' },
    ),
  messages: (id: string) => client.request<{ data: LobbyMessage[] }>(`/matches/${id}/messages`),
  sendMessage: (id: string, input: SendLobbyMessageInput) =>
    client.request<{ data: LobbyMessage }>(`/matches/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
});
