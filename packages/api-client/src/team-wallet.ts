import type {
  ReclaimableTeamContribution,
  TeamContributionResult,
  TeamWalletHoldView,
  TeamWalletPage,
  TeamWalletSummary,
} from '@footy-finder/shared';
import type { ApiClient } from './client.js';

/** Gate 7 (TKT-702/703): Team Wallet balance, history, contributions and self-refunds. */
export const teamWalletApi = (client: ApiClient) => ({
  summary: (teamId: string) => client.request<{ data: TeamWalletSummary }>(`/teams/${teamId}/wallet`),
  transactions: (teamId: string, params: { cursor?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.cursor) search.set('cursor', params.cursor);
    if (params.limit) search.set('limit', String(params.limit));
    const query = search.toString();
    return client.request<{ data: TeamWalletPage }>(`/teams/${teamId}/wallet/transactions${query ? `?${query}` : ''}`);
  },
  holds: (teamId: string) => client.request<{ data: TeamWalletHoldView[] }>(`/teams/${teamId}/wallet/holds`),
  contribute: (teamId: string, amountCents: number, idempotencyKey: string) =>
    client.request<{ data: TeamContributionResult }>(`/teams/${teamId}/wallet/contributions`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ amountCents }),
    }),
  refund: (teamId: string, amountCents: number, idempotencyKey: string) =>
    client.request<{ data: { replayed: boolean; wallet: TeamWalletSummary } }>(`/teams/${teamId}/wallet/refunds`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ amountCents }),
    }),
  reclaimable: () => client.request<{ data: ReclaimableTeamContribution[] }>('/wallet/team-contributions'),
});
