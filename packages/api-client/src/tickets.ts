import type { MatchTicketContext, MyTicketsOverview, TeamPaymentRoster, TeamSide, TeamTicketCheckoutInput, TicketChoiceInput, TicketCheckoutInput, TicketCheckoutResult, TicketLeaveResult } from '@footy-finder/shared';
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
  /** DEC-021 A2: leave; more than 24 hours before kick-off a paid place needs a choice (CREDIT or REFUND). */
  leave: (matchId: string, choice?: 'CREDIT' | 'REFUND') =>
    client.request<{ data: TicketLeaveResult }>(`/matches/${encodeURIComponent(matchId)}/tickets/leave`, {
      method: 'POST',
      body: JSON.stringify(choice ? { choice } : {}),
    }),
  /** DEC-021 A3: what a cancelled match gives back (a match credit or a full refund), for the payer's places. */
  choose: (matchId: string, input: TicketChoiceInput) =>
    client.request<{ data: { resolved: number; choice: 'CREDIT' | 'REFUND' } }>(`/matches/${encodeURIComponent(matchId)}/tickets/choice`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** DEC-021 A5: a team side's payment checklist, and paying for named teammates (one Paystack payment). */
  teamRoster: (matchId: string, side: TeamSide) =>
    client.request<{ data: TeamPaymentRoster }>(`/matches/${encodeURIComponent(matchId)}/team-sides/${side}/tickets`),
  teamCheckout: (matchId: string, side: TeamSide, input: TeamTicketCheckoutInput, idempotencyKey: string) =>
    client.request<{ data: TicketCheckoutResult }>(`/matches/${encodeURIComponent(matchId)}/team-sides/${side}/tickets/checkout`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    }),
  /** DEC-021 "Tickets & credits": upcoming and past tickets, match credits with expiry, refunds and their status. */
  mine: () => client.request<{ data: MyTicketsOverview }>('/tickets/mine'),
  checkoutStatus: (checkoutId: string) => client.request<{ data: TicketCheckoutResult }>(`/tickets/checkouts/${encodeURIComponent(checkoutId)}`),
  checkoutStatusByReference: (reference: string) =>
    client.request<{ data: TicketCheckoutResult }>(`/tickets/checkouts/by-reference/${encodeURIComponent(reference)}`),
});
