import type {
  CreateMatchInput,
  DiscoveryQuery,
  FormationSlotUpdateInput,
  JoinMatchInput,
  ResultInput,
} from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currentUserKey } from '@/features/auth/hooks/useAuth.js';
import { matchApi } from '../api/matches.js';
export const matchesKey = ['matches'] as const;
export const matchKey = (id: string) => ['matches', id] as const;
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
export const useReadyMatch = (id: string) => lobbyMutation<void>(id, () => matchApi.ready(id));
export const useFormationUpdate = (id: string) =>
  lobbyMutation<{ slotId: string; input: FormationSlotUpdateInput }>(id, ({ slotId, input }) =>
    matchApi.formation(id, slotId, input),
  );
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
