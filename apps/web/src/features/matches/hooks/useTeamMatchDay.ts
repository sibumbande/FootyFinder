import type {
  AssignTeamMatchStarterInput,
  OpenTeamMatchLineupSlotInput,
  RemoveTeamMatchStarterInput,
  TeamMatchAvailabilityQuery,
  TeamMatchLineup,
  TeamSide,
  UpdateMyTeamMatchAvailabilityInput,
  UpdateTeamMatchLineupSlotPositionInput,
} from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { teamFormationKey } from '@/features/teams/hooks/useTeams.js';
import { matchApi } from '../api/matches.js';
import { matchKey } from './useMatches.js';

export const teamMatchAvailabilityRootKey = (matchId: string, side: TeamSide) =>
  [...matchKey(matchId), 'team-side', side, 'availability'] as const;
export const teamMatchAvailabilityKey = (
  matchId: string,
  side: TeamSide,
  filters: Partial<TeamMatchAvailabilityQuery> = {},
) => [...teamMatchAvailabilityRootKey(matchId, side), filters] as const;
export const teamMatchLineupKey = (matchId: string, side: TeamSide) =>
  [...matchKey(matchId), 'team-side', side, 'lineup'] as const;

export const useTeamMatchAvailability = (
  matchId: string,
  side: TeamSide,
  filters: Partial<TeamMatchAvailabilityQuery> = {},
) =>
  useQuery({
    queryKey: teamMatchAvailabilityKey(matchId, side, filters),
    queryFn: async () => (await matchApi.availability(matchId, side, filters)).data,
    enabled: Boolean(matchId),
  });

export function useTeamMatchAvailabilityMutations(matchId: string, side: TeamSide) {
  const cache = useQueryClient();
  const refresh = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: teamMatchAvailabilityRootKey(matchId, side) }),
      cache.invalidateQueries({ queryKey: matchKey(matchId) }),
    ]);
  return {
    request: useMutation({
      mutationFn: () => matchApi.requestAvailability(matchId, side),
      onSuccess: refresh,
    }),
    updateMine: useMutation({
      mutationFn: (input: UpdateMyTeamMatchAvailabilityInput) =>
        matchApi.updateMyAvailability(matchId, side, input),
      onSuccess: refresh,
    }),
  };
}

export const useTeamMatchLineup = (matchId: string, side: TeamSide) =>
  useQuery({
    queryKey: teamMatchLineupKey(matchId, side),
    queryFn: async () => (await matchApi.lineup(matchId, side)).data,
    enabled: Boolean(matchId),
  });

export function useTeamMatchLineupMutations(matchId: string, side: TeamSide) {
  const cache = useQueryClient();
  const update = (lineup: TeamMatchLineup) => {
    cache.setQueryData(teamMatchLineupKey(matchId, side), lineup);
    void cache.invalidateQueries({ queryKey: teamMatchAvailabilityRootKey(matchId, side) });
    void cache.invalidateQueries({ queryKey: matchKey(matchId) });
  };
  const recover = () =>
    void cache.invalidateQueries({ queryKey: teamMatchLineupKey(matchId, side) });
  const mutation = <T>(work: (input: T) => Promise<{ data: TeamMatchLineup }>) =>
    useMutation({
      mutationFn: work,
      onSuccess: ({ data }) => update(data),
      onError: recover,
    });
  return {
    invite: mutation<string>((userId) => matchApi.inviteLineupPlayer(matchId, side, userId)),
    assign: mutation<{ slotId: string; input: AssignTeamMatchStarterInput }>(({ slotId, input }) =>
      matchApi.assignLineupStarter(matchId, side, slotId, input),
    ),
    removeStarter: mutation<{ slotId: string; input: RemoveTeamMatchStarterInput }>(
      ({ slotId, input }) => matchApi.removeLineupStarter(matchId, side, slotId, input),
    ),
    open: mutation<{ slotId: string; input?: OpenTeamMatchLineupSlotInput }>(({ slotId, input }) =>
      matchApi.openLineupSlot(matchId, side, slotId, input),
    ),
    claim: mutation<string>((slotId) => matchApi.claimLineupSlot(matchId, side, slotId)),
    move: mutation<{ slotId: string; input: UpdateTeamMatchLineupSlotPositionInput }>(
      ({ slotId, input }) => matchApi.moveLineupSlot(matchId, side, slotId, input),
    ),
    selectSubstitute: mutation<string>((userId) =>
      matchApi.selectLineupSubstitute(matchId, side, userId),
    ),
    removeSubstitute: mutation<string>((userId) =>
      matchApi.removeLineupSubstitute(matchId, side, userId),
    ),
    decline: mutation<void>(() => matchApi.declineLineupSelection(matchId, side)),
    finalize: mutation<void>(() => matchApi.finalizeLineup(matchId, side)),
    saveDefault: useMutation({
      mutationFn: () => matchApi.saveLineupAsTeamDefault(matchId, side),
      onSuccess: ({ data }) => {
        cache.setQueryData(teamFormationKey(data.teamId, data.format), data);
      },
    }),
  };
}
