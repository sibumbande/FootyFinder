import type { DeclineRefereeInput, RefereeResultInput } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { refereeClient } from '@/api/client.js';

export const refereeKey = ['referee'] as const;
export const refereeMatchKey = (matchId: string) => [...refereeKey, 'match', matchId] as const;

/** Gate 8 / TKT-805: the referee's assigned matches. */
export const useRefereeMatches = () =>
  useQuery({
    queryKey: [...refereeKey, 'matches'],
    queryFn: async () => (await refereeClient.matches()).data,
    refetchInterval: 60_000,
  });

export const useRefereeMatch = (matchId: string) =>
  useQuery({
    queryKey: refereeMatchKey(matchId),
    queryFn: async () => (await refereeClient.match(matchId)).data,
    enabled: Boolean(matchId),
    refetchInterval: 30_000,
  });

const useRefresh = () => {
  const cache = useQueryClient();
  return () => void cache.invalidateQueries({ queryKey: refereeKey });
};

export const useDeclineRefereeMatch = (matchId: string) => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: DeclineRefereeInput) => refereeClient.decline(matchId, input),
    onSuccess: refresh,
  });
};

export const useSubmitRefereeResult = (matchId: string) => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: RefereeResultInput) => refereeClient.submitResult(matchId, input),
    onSuccess: refresh,
  });
};
