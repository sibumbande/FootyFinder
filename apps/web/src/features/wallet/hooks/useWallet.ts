import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { walletClient } from '@/api/client.js';
import { currentUserKey } from '@/features/auth/hooks/useAuth.js';

export const walletKey = ['wallet'] as const;
export const walletSummaryKey = [...walletKey, 'summary'] as const;
export const walletHistoryKey = [...walletKey, 'history'] as const;

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

export function useAddFunds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await walletClient.demoDeposit(crypto.randomUUID());
      if (data.status !== 'success' || !data.user)
        throw new Error(data.message ?? 'The deposit could not be completed.');
      return data;
    },
    onSuccess: ({ user }) => {
      queryClient.setQueryData(currentUserKey, user);
      void queryClient.invalidateQueries({ queryKey: walletKey });
    },
  });
}
