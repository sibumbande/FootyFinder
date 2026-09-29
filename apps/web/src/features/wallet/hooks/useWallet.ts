import type { PaymentProviderName } from '@footy-finder/shared';
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

/** Hosted checkout must be Paystack's own page; anything else is refused. */
export const isPaystackCheckoutUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.paystack.com';
  } catch {
    return false;
  }
};

export const checkoutNavigation = { go: (url: string) => window.location.assign(url) };

export type TopUpResult = { kind: 'credited' } | { kind: 'redirected' };

/**
 * Starts a top-up. With the development/test demo operator the wallet is credited immediately.
 * With Paystack the player is sent to hosted checkout; the wallet is credited only after our
 * server verifies the payment, never because the browser came back.
 */
export function useTopUp(provider: PaymentProviderName | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ amountCents, idempotencyKey }: { amountCents: number; idempotencyKey: string }): Promise<TopUpResult> => {
      if (provider === 'paystack') {
        const { data } = await walletClient.startTopUp(amountCents, idempotencyKey);
        if (data.state === 'SUCCEEDED') return { kind: 'credited' };
        if (!data.authorizationUrl || !isPaystackCheckoutUrl(data.authorizationUrl))
          throw new Error('Card checkout could not be started. Please try again.');
        checkoutNavigation.go(data.authorizationUrl);
        return { kind: 'redirected' };
      }
      const { data } = await walletClient.demoDeposit(amountCents, idempotencyKey);
      if (data.status !== 'success' || !data.user)
        throw new Error(data.message ?? 'The top-up could not be completed.');
      queryClient.setQueryData(currentUserKey, data.user);
      return { kind: 'credited' };
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: walletKey }),
  });
}

/** Polls the player's own top-up after returning from Paystack until it settles. */
export function useTopUpStatus(reference: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: [...walletKey, 'top-up', reference],
    enabled: Boolean(reference),
    queryFn: async () => {
      const { data } = await walletClient.topUpStatus(reference!);
      if (data.state !== 'PROCESSING') {
        void queryClient.invalidateQueries({ queryKey: currentUserKey });
        void queryClient.invalidateQueries({ queryKey: walletSummaryKey });
        void queryClient.invalidateQueries({ queryKey: walletHistoryKey });
      }
      return data;
    },
    // Poll every 3 s for up to two minutes; after that the page offers a manual refresh.
    refetchInterval: (query) =>
      (query.state.data && query.state.data.state !== 'PROCESSING') || query.state.dataUpdateCount >= 40
        ? false
        : 3_000,
  });
}
