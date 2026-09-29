import type {
  DepositResponse,
  TopUpOptions,
  WalletLedgerPage,
  WalletSummary,
} from '@footy-finder/shared';
import type { ApiClient } from './client.js';

export const walletApi = (client: ApiClient) => ({
  summary: () => client.request<{ data: WalletSummary }>('/wallet'),
  transactions: (params: { cursor?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.cursor) search.set('cursor', params.cursor);
    if (params.limit) search.set('limit', String(params.limit));
    const query = search.toString();
    return client.request<{ data: WalletLedgerPage }>(`/wallet/transactions${query ? `?${query}` : ''}`);
  },
  topUpOptions: () => client.request<{ data: TopUpOptions }>('/wallet/top-up-options'),
  /** Development/test only: the server answers 404 in production. */
  demoDeposit: (amountCents: number, idempotencyKey: string) =>
    client.request<{ data: DepositResponse }>('/wallet/deposits/demo', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ amountCents }),
    }),
});
