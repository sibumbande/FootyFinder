import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { teamWalletClient } from '@/api/client.js';
import { currentUserKey } from '@/features/auth/hooks/useAuth.js';
import { walletKey } from '@/features/wallet/hooks/useWallet.js';
import { teamKey } from './useTeams.js';

export const teamWalletKey = (teamId: string) => [...teamKey(teamId), 'wallet'] as const;
export const reclaimableTeamMoneyKey = [...walletKey, 'team-contributions'] as const;

export const useTeamWalletSummary = (teamId: string, enabled = true) =>
  useQuery({
    queryKey: [...teamWalletKey(teamId), 'summary'],
    queryFn: async () => (await teamWalletClient.summary(teamId)).data,
    enabled: Boolean(teamId) && enabled,
  });

export const useTeamWalletHistory = (teamId: string, enabled = true) =>
  useInfiniteQuery({
    queryKey: [...teamWalletKey(teamId), 'history'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => (await teamWalletClient.transactions(teamId, { cursor: pageParam })).data,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(teamId) && enabled,
  });

/** Only owners and captains are allowed to read holds; the server refuses anyone else. */
export const useTeamWalletHolds = (teamId: string, enabled: boolean) =>
  useQuery({
    queryKey: [...teamWalletKey(teamId), 'holds'],
    queryFn: async () => (await teamWalletClient.holds(teamId)).data,
    enabled: Boolean(teamId) && enabled,
  });

export const useReclaimableTeamMoney = () =>
  useQuery({
    queryKey: reclaimableTeamMoneyKey,
    queryFn: async () => (await teamWalletClient.reclaimable()).data,
  });

const useRefreshAfterTeamMoney = (teamId: string) => {
  const cache = useQueryClient();
  return () => {
    void cache.invalidateQueries({ queryKey: teamWalletKey(teamId) });
    void cache.invalidateQueries({ queryKey: walletKey });
    void cache.invalidateQueries({ queryKey: currentUserKey });
  };
};

export function useContributeToTeam(teamId: string) {
  const refresh = useRefreshAfterTeamMoney(teamId);
  return useMutation({
    mutationFn: ({ amountCents, idempotencyKey }: { amountCents: number; idempotencyKey: string }) =>
      teamWalletClient.contribute(teamId, amountCents, idempotencyKey),
    onSuccess: refresh,
  });
}

export function useRefundTeamContribution(teamId: string) {
  const refresh = useRefreshAfterTeamMoney(teamId);
  return useMutation({
    mutationFn: ({ amountCents, idempotencyKey }: { amountCents: number; idempotencyKey: string }) =>
      teamWalletClient.refund(teamId, amountCents, idempotencyKey),
    onSuccess: refresh,
  });
}
