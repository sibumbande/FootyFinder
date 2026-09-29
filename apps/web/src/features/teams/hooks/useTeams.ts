import type {
  CreateTeamInput,
  MatchFormat,
  TeamRole,
  UpdateTeamFormationSlotInput,
  UpdateTeamInput,
} from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { teamsClient } from '@/api/client.js';
import { currentUserKey } from '@/features/auth/hooks/useAuth.js';

export const myTeamsKey = ['teams', 'mine'] as const;
export const teamKey = (teamId: string) => ['teams', teamId] as const;
export const teamInvitesKey = (teamId: string) => [...teamKey(teamId), 'invites'] as const;
export const teamFormationKey = (teamId: string, format: MatchFormat) =>
  [...teamKey(teamId), 'formation', format] as const;
export const teamMatchesKey = (teamId: string) => [...teamKey(teamId), 'matches'] as const;

export const useMyTeams = () =>
  useQuery({ queryKey: myTeamsKey, queryFn: async () => (await teamsClient.list()).data });
export const useTeam = (teamId: string) =>
  useQuery({
    queryKey: teamKey(teamId),
    queryFn: async () => (await teamsClient.get(teamId)).data,
    enabled: Boolean(teamId),
  });
export function useCreateTeam() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async ({ input, image }: { input: CreateTeamInput; image?: File }) => {
      const created = await teamsClient.create(input);
      if (!image) return created;
      try {
        return await teamsClient.uploadImage(created.data.id, image);
      } catch (error) {
        // Keep the multi-step browser flow atomic from the user's perspective.
        // A failed image upload must not leave an invisible duplicate Team behind.
        await teamsClient.remove(created.data.id).catch(() => undefined);
        throw error;
      }
    },
    onSuccess: ({ data }) => {
      cache.setQueryData(teamKey(data.id), data);
      void cache.invalidateQueries({ queryKey: myTeamsKey });
      void cache.invalidateQueries({ queryKey: currentUserKey });
    },
  });
}
export const useTeamMatches = (teamId: string) =>
  useQuery({
    queryKey: teamMatchesKey(teamId),
    queryFn: async () => (await teamsClient.matches(teamId)).data,
    enabled: Boolean(teamId),
  });
export function useUpdateTeam(teamId: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTeamInput) => teamsClient.update(teamId, input),
    onSuccess: ({ data }) => {
      cache.setQueryData(teamKey(teamId), data);
      void cache.invalidateQueries({ queryKey: myTeamsKey });
    },
  });
}
export function useUploadTeamImage(teamId: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (image: File) => teamsClient.uploadImage(teamId, image),
    onSuccess: ({ data }) => {
      cache.setQueryData(teamKey(teamId), data);
      void cache.invalidateQueries({ queryKey: myTeamsKey });
    },
  });
}
export function useDeleteTeam(teamId: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: () => teamsClient.remove(teamId),
    onSuccess: () => {
      cache.removeQueries({ queryKey: teamKey(teamId) });
      void cache.invalidateQueries({ queryKey: myTeamsKey });
      void cache.invalidateQueries({ queryKey: currentUserKey });
    },
  });
}
export function useTeamMemberMutation(teamId: string) {
  const cache = useQueryClient();
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: teamKey(teamId) });
    void cache.invalidateQueries({ queryKey: myTeamsKey });
  };
  const role = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Exclude<TeamRole, 'OWNER'> }) =>
      teamsClient.updateMemberRole(teamId, userId, { role }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => teamsClient.removeMember(teamId, userId),
    onSuccess: refresh,
  });
  return { role, remove };
}
export const useTeamInvites = (teamId: string, enabled: boolean) =>
  useQuery({
    queryKey: teamInvitesKey(teamId),
    queryFn: async () => (await teamsClient.invites(teamId)).data,
    enabled: Boolean(teamId) && enabled,
  });
export function useTeamInviteMutations(teamId: string) {
  const cache = useQueryClient();
  return {
    create: useMutation({
      mutationFn: () => teamsClient.createInvite(teamId),
      onSuccess: () => void cache.invalidateQueries({ queryKey: teamInvitesKey(teamId) }),
    }),
    revoke: useMutation({
      mutationFn: (inviteId: string) => teamsClient.revokeInvite(teamId, inviteId),
      onSuccess: () => void cache.invalidateQueries({ queryKey: teamInvitesKey(teamId) }),
    }),
  };
}
export const useTeamFormation = (teamId: string, format: MatchFormat) =>
  useQuery({
    queryKey: teamFormationKey(teamId, format),
    queryFn: async () => (await teamsClient.formation(teamId, format)).data,
    enabled: Boolean(teamId),
  });
export function useTeamFormationMutations(teamId: string, format: MatchFormat) {
  const cache = useQueryClient();
  return {
    preset: useMutation({
      mutationFn: (formationKey: string) =>
        teamsClient.saveFormation(teamId, format, { formationKey }),
      onSuccess: ({ data }) => cache.setQueryData(teamFormationKey(teamId, format), data),
    }),
    slot: useMutation({
      mutationFn: ({ slotId, input }: { slotId: string; input: UpdateTeamFormationSlotInput }) =>
        teamsClient.updateFormationSlot(teamId, format, slotId, input),
      onSuccess: ({ data }) => cache.setQueryData(teamFormationKey(teamId, format), data),
    }),
  };
}
export const useInspectTeamInvite = (token: string) =>
  useQuery({
    queryKey: ['team-invite', token],
    queryFn: async () => (await teamsClient.inspectInvite(token)).data,
    retry: false,
  });
export function useAcceptTeamInvite(token: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: () => teamsClient.acceptInvite(token),
    onSuccess: ({ data }) => {
      cache.setQueryData(teamKey(data.team.id), data.team);
      void cache.invalidateQueries({ queryKey: myTeamsKey });
      void cache.invalidateQueries({ queryKey: currentUserKey });
    },
  });
}
