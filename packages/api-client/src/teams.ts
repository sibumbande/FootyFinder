import type {
  CreateTeamInput,
  CreateTeamMatchInput,
  Match,
  MatchFormat,
  SaveTeamFormationInput,
  TeamDetail,
  TeamFormation,
  TeamInviteLanding,
  TeamInviteMetadata,
  TeamMember,
  TeamSummary,
  UpdateTeamFormationSlotInput,
  UpdateTeamInput,
  UpdateTeamMemberRoleInput,
} from '@footy-finder/shared';
import type { ApiClient } from './client.js';

export const teamsApi = (client: ApiClient) => ({
  create: (input: CreateTeamInput) =>
    client.request<{ data: TeamDetail }>('/teams', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  list: () => client.request<{ data: TeamSummary[] }>('/teams'),
  get: (teamId: string) => client.request<{ data: TeamDetail }>(`/teams/${teamId}`),
  update: (teamId: string, input: UpdateTeamInput) =>
    client.request<{ data: TeamDetail }>(`/teams/${teamId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (teamId: string) =>
    client.request<{ data: { success: true } }>(`/teams/${teamId}`, { method: 'DELETE' }),
  createMatch: (teamId: string, input: CreateTeamMatchInput) =>
    client.request<{ data: Match }>(`/teams/${teamId}/matches`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  matches: (teamId: string) => client.request<{ data: Match[] }>(`/teams/${teamId}/matches`),
  uploadImage: (teamId: string, image: File) => {
    const body = new FormData();
    body.append('image', image);
    return client.request<{ data: TeamDetail }>(`/teams/${teamId}/image`, {
      method: 'POST',
      body,
    });
  },
  members: (teamId: string) => client.request<{ data: TeamMember[] }>(`/teams/${teamId}/members`),
  updateMemberRole: (teamId: string, userId: string, input: UpdateTeamMemberRoleInput) =>
    client.request<{ data: TeamMember }>(`/teams/${teamId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removeMember: (teamId: string, userId: string) =>
    client.request<{ data: { success: true } }>(`/teams/${teamId}/members/${userId}`, {
      method: 'DELETE',
    }),
  createInvite: (teamId: string) =>
    client.request<{ data: TeamInviteMetadata }>(`/teams/${teamId}/invites`, {
      method: 'POST',
    }),
  invites: (teamId: string) =>
    client.request<{ data: TeamInviteMetadata[] }>(`/teams/${teamId}/invites`),
  revokeInvite: (teamId: string, inviteId: string) =>
    client.request<{ data: { success: true } }>(`/teams/${teamId}/invites/${inviteId}`, {
      method: 'DELETE',
    }),
  inspectInvite: (token: string) =>
    client.request<{ data: TeamInviteLanding }>(`/team-invites/${token}`),
  acceptInvite: (token: string) =>
    client.request<{ data: { team: TeamDetail; alreadyMember: boolean } }>(
      `/team-invites/${token}/accept`,
      { method: 'POST' },
    ),
  formation: (teamId: string, format: MatchFormat) =>
    client.request<{ data: TeamFormation }>(`/teams/${teamId}/formations/${format}`),
  saveFormation: (teamId: string, format: MatchFormat, input: SaveTeamFormationInput) =>
    client.request<{ data: TeamFormation }>(`/teams/${teamId}/formations/${format}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  updateFormationSlot: (
    teamId: string,
    format: MatchFormat,
    slotId: string,
    input: UpdateTeamFormationSlotInput,
  ) =>
    client.request<{ data: TeamFormation }>(
      `/teams/${teamId}/formations/${format}/slots/${slotId}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    ),
});
