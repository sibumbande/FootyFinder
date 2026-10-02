import type { MatchTicketContext, TicketCheckoutInput, TicketCheckoutResult } from '@footy-finder/shared';
import type { ApiClient } from './client.js';

/** DEC-021 Match Ticketing: buy a ticket for one place; check a checkout's status (never confirms anything). */
export const ticketsApi = (client: ApiClient) => ({
  context: (matchId: string) => client.request<{ data: MatchTicketContext }>(`/matches/${encodeURIComponent(matchId)}/tickets/context`),
  checkout: (matchId: string, input: TicketCheckoutInput, idempotencyKey: string) =>
    client.request<{ data: TicketCheckoutResult }>(`/matches/${encodeURIComponent(matchId)}/tickets/checkout`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    }),
  checkoutStatus: (checkoutId: string) => client.request<{ data: TicketCheckoutResult }>(`/tickets/checkouts/${encodeURIComponent(checkoutId)}`),
  checkoutStatusByReference: (reference: string) =>
    client.request<{ data: TicketCheckoutResult }>(`/tickets/checkouts/by-reference/${encodeURIComponent(reference)}`),
});
