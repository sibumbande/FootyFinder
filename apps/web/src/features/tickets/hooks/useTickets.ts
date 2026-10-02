import type { TicketCheckoutInput, TicketCheckoutResult } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketsClient } from '@/api/client.js';
import { matchKey } from '@/features/matches/hooks/useMatches.js';

export const ticketContextKey = (matchId: string) => [...matchKey(matchId), 'ticket-context'] as const;
export const checkoutKey = (reference: string) => ['ticket-checkout', reference] as const;

/** Paystack's hosted checkout is the only place a card or bank payment is taken; any other address is refused. */
export const isPaystackCheckoutUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.paystack.com';
  } catch {
    return false;
  }
};

/** Indirection so tests can observe the redirect without leaving the page. */
export const checkoutNavigation = { go: (url: string) => window.location.assign(url) };

/** The viewer's ticket, credits and the cancellation policy for one match (DEC-021). */
export const useTicketContext = (matchId: string, enabled = true) =>
  useQuery({
    queryKey: ticketContextKey(matchId),
    queryFn: async () => (await ticketsClient.context(matchId)).data,
    enabled: enabled && Boolean(matchId),
  });

export type TicketPurchase = { kind: 'confirmed'; result: TicketCheckoutResult } | { kind: 'redirected' };

/**
 * DEC-021 A1: buys a ticket. A paid place goes to Paystack's hosted checkout (the player is placed only once our
 * server verifies the payment); a free place, or the development demo operator, is confirmed straight away.
 */
export function useBuyTicket(matchId: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: TicketCheckoutInput; idempotencyKey: string }): Promise<TicketPurchase> => {
      const { data } = await ticketsClient.checkout(matchId, input, idempotencyKey);
      if (data.state === 'CONFIRMED') return { kind: 'confirmed', result: data };
      if (data.state === 'PROCESSING' && data.authorizationUrl) {
        if (!isPaystackCheckoutUrl(data.authorizationUrl)) throw new Error('Checkout could not be started. Please try again.');
        checkoutNavigation.go(data.authorizationUrl);
        return { kind: 'redirected' };
      }
      throw new Error('Checkout could not be started. Please try again.');
    },
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: matchKey(matchId) });
    },
  });
}

/** The return page: asks our server (which verifies with Paystack) until the ticket is confirmed or refused. */
export const useCheckoutByReference = (reference: string | null) =>
  useQuery({
    queryKey: checkoutKey(reference ?? ''),
    queryFn: async () => (await ticketsClient.checkoutStatusByReference(reference!)).data,
    enabled: Boolean(reference),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state && state !== 'PROCESSING') return false;
      return query.state.dataUpdateCount < 40 ? 3_000 : false;
    },
  });
