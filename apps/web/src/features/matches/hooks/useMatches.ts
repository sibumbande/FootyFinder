import type {
  CreateMatchInput,
  DiscoveryQuery,
  FormationSlotUpdateInput,
  Match,
  JoinMatchInput,
  ResultInput,
} from '@footy-finder/shared';
import { ApiError } from '@footy-finder/api-client';
import { replaceEqualDeep, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currentUserKey } from '@/features/auth/hooks/useAuth.js';
import { matchApi } from '../api/matches.js';
import {
  applyFormationSnapshot,
  isFormationSnapshot,
  keepNewerFormation,
  matchQueryKey,
} from '../utils/formation-cache.js';
export const matchesKey = ['matches'] as const;
export const matchKey = matchQueryKey;
export const publicMatchKey = (slug: string) => ['public-match', slug] as const;
export const useMatches = (query?: Partial<DiscoveryQuery>) =>
  useQuery({
    queryKey: [...matchesKey, query],
    queryFn: async () => (await matchApi.list(query)).data,
  });
export const useMatch = (id: string) =>
  useQuery({
    queryKey: matchKey(id),
    queryFn: async () => (await matchApi.get(id)).data,
    enabled: Boolean(id),
    refetchInterval: 30_000,
    structuralSharing: (previous, next) =>
      replaceEqualDeep(previous, keepNewerFormation(previous as Match | undefined, next as Match)),
  });
export const usePublicMatchPreview = (slug: string) =>
  useQuery({
    queryKey: publicMatchKey(slug),
    queryFn: async () => (await matchApi.publicPreview(slug)).data,
    enabled: Boolean(slug),
    staleTime: 30_000,
  });
export const useMatchByPublicSlug = (slug: string, enabled = true) =>
  useQuery({
    queryKey: [...publicMatchKey(slug), 'authenticated'],
    queryFn: async () => (await matchApi.getByPublicSlug(slug)).data,
    enabled: Boolean(slug) && enabled,
    refetchInterval: 30_000,
  });
export function useCreateMatch() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMatchInput) => matchApi.create(input),
    onSuccess: ({ data }) => {
      cache.setQueryData(matchKey(data.id), data);
      void cache.invalidateQueries({ queryKey: matchesKey });
    },
  });
}
function lobbyMutation<T>(id: string, action: (input: T) => Promise<unknown>) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: matchKey(id) }),
        cache.invalidateQueries({ queryKey: matchesKey }),
        cache.invalidateQueries({ queryKey: currentUserKey }),
      ]);
    },
  });
}
export const useJoinMatch = (id: string) =>
  lobbyMutation<JoinMatchInput>(id, (input) => matchApi.join(id, input, crypto.randomUUID()));
export const useCancellationQuote = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: [...matchKey(id), 'cancellation-quote'],
    queryFn: async () => (await matchApi.cancellationQuote(id)).data,
    enabled,
  });
export const useCancellationStatus = (id: string, enabled = true) =>
  useQuery({
    queryKey: [...matchKey(id), 'cancellation-status'],
    queryFn: async () => (await matchApi.cancellationStatus(id)).data,
    enabled: Boolean(id) && enabled,
    refetchInterval: 15_000,
  });
export const useLeaveMatch = (id: string) => lobbyMutation<void>(id, () => matchApi.leave(id));
/** Gate 7: "Load my team" into, and "Withdraw my team" from, the other side of a team match. */
export const useLoadTeamIntoMatch = (id: string) =>
  lobbyMutation<{ teamId: string; substituteCount: number }>(id, (input) => matchApi.loadTeam(id, input));
export const useWithdrawTeamFromMatch = (id: string) => lobbyMutation<void>(id, () => matchApi.withdrawTeam(id));
/** DEC-021 D1: a team's subs; the payment checklist (under the match key) refreshes with it. */
export const useChangeTeamSubstitutes = (id: string, side: 'HOME' | 'AWAY') =>
  lobbyMutation<number>(id, (substituteCount) => matchApi.changeTeamSubstitutes(id, side, substituteCount));
export const useReadyMatch = (id: string) => lobbyMutation<void>(id, () => matchApi.ready(id));
export function useRotateMatchInvite(id: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: () => matchApi.rotateInvite(id),
    onSuccess: ({ data }) => cache.setQueryData(matchKey(id), data),
  });
}
/**
 * Organiser formation edits touch only this lobby: no wallet, participation, or list data changes,
 * so only this Match is refreshed. The versioned socket echo usually lands first. The refetch is
 * the fallback when the socket is disconnected.
 */
export function useFormationUpdate(id: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ slotId, input }: { slotId: string; input: FormationSlotUpdateInput }) =>
      matchApi.formation(id, slotId, input),
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: matchKey(id), exact: true });
    },
  });
}
/**
 * DEC-013 self-claim. A committed claim writes its snapshot straight into the lobby cache. A lost
 * race carries the authoritative formation in the conflict details, so the board converges
 * without waiting for a refetch.
 */
export function useClaimPosition(id: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (slotId: string) => matchApi.claimPosition(id, slotId),
    onSuccess: ({ data }) => {
      applyFormationSnapshot(cache, data);
    },
    onError: (error) => {
      if (error instanceof ApiError && isFormationSnapshot(error.details))
        applyFormationSnapshot(cache, error.details);
      else void cache.invalidateQueries({ queryKey: matchKey(id) });
    },
  });
}
export const useChangeTeam = (id: string) =>
  lobbyMutation<{ participantId: string; team: 'HOME' | 'AWAY' }>(id, ({ participantId, team }) =>
    matchApi.changeTeam(id, participantId, { team }),
  );
export const useSubmitResult = (id: string) =>
  lobbyMutation<ResultInput>(id, (input) => matchApi.submitResult(id, input));
export function useDeleteMatch(id: string, teamId?: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: () => matchApi.remove(id),
    onSuccess: () => {
      cache.removeQueries({ queryKey: matchKey(id) });
      void cache.invalidateQueries({ queryKey: matchesKey });
      if (teamId) void cache.invalidateQueries({ queryKey: ['teams', teamId, 'matches'] });
    },
  });
}
export const useLobbyMessages = (id: string, enabled = true) =>
  useQuery({
    queryKey: [...matchKey(id), 'messages'],
    queryFn: async () => (await matchApi.messages(id)).data,
    enabled: Boolean(id) && enabled,
    refetchInterval: 5_000,
  });
export function useSendLobbyMessage(id: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => matchApi.sendMessage(id, { content }),
    onSuccess: ({ data }) =>
      cache.setQueryData([...matchKey(id), 'messages'], (current: (typeof data)[] | undefined) => [
        ...(current ?? []),
        data,
      ]),
  });
}
