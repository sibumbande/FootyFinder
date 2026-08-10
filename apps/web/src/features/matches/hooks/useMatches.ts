import type { CreateMatchInput } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currentUserKey } from '@/features/auth/hooks/useAuth.js';
import { matchApi } from '../api/matches.js';

export const matchesKey = ['matches'] as const;
export const matchKey = (id: string) => ['matches', id] as const;

export const useMatches = () => useQuery({ queryKey: matchesKey, queryFn: async () => (await matchApi.list()).data });
export const useMatch = (id: string) => useQuery({ queryKey: matchKey(id), queryFn: async () => (await matchApi.get(id)).data, enabled: Boolean(id) });

export function useCreateMatch() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (input: CreateMatchInput) => matchApi.create(input), onSuccess: ({ data }) => { queryClient.setQueryData(matchKey(data.id), data); void Promise.all([queryClient.invalidateQueries({ queryKey: matchesKey }), queryClient.invalidateQueries({ queryKey: currentUserKey })]); } });
}

function useLobbyMutation(id: string, action: () => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: action, onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: matchKey(id) }), queryClient.invalidateQueries({ queryKey: matchesKey }), queryClient.invalidateQueries({ queryKey: currentUserKey })]); } });
}

export const useJoinMatch = (id: string) => useLobbyMutation(id, () => matchApi.join(id));
export const useLeaveMatch = (id: string) => useLobbyMutation(id, () => matchApi.leave(id));

export function useDeleteMatch(id: string) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: () => matchApi.remove(id), onSuccess: () => { queryClient.removeQueries({ queryKey: matchKey(id) }); void queryClient.invalidateQueries({ queryKey: matchesKey }); } });
}
