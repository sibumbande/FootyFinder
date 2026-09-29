import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { walletClient } from '@/api/client.js';
import { currentUserKey } from '@/features/auth/hooks/useAuth.js';

export const walletKey = ['wallet'] as const;
export const walletSummaryKey = [...walletKey, 'summary'] as const;
export const walletHistoryKey = [...walletKey, 'history'] as const;
export const topUpOptionsKey = [...walletKey, 'top-up-options'] as const;

export function useWalletSummary() {
  return useQuery({
    queryKey: walletSummaryKey,
    queryFn: async () => (await walletClient.summary()).data,
  });
}

export function useWalletHistory() {
  return useInfiniteQuery({
    queryKey: walletHistoryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => (await walletClient.transactions({ cursor: pageParam })).data,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useTopUpOptions() {
  return useQuery({
    queryKey: topUpOptionsKey,
    queryFn: async () => (await walletClient.topUpOptions()).data,
    staleTime: Infinity,
  });
}

/**
 * Starts a top-up. With the development/test demo operator the wallet is credited immediately;
 * card top-ups are handled by the payment provider flow.
 */
export function useTopUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ amountCents, idempotencyKey }: { amountCents: number; idempotencyKey: string }) => {
      const { data } = await walletClient.demoDeposit(amountCents, idempotencyKey);
      if (data.status !== 'success' || !data.user)
        throw new Error(data.message ?? 'The top-up could not be completed.');
      return data;
    },
    onSuccess: ({ user }) => {
      if (user) queryClient.setQueryData(currentUserKey, user);
      void queryClient.invalidateQueries({ queryKey: walletKey });
    },
  });
}
