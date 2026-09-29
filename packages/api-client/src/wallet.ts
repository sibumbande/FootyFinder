import type {
  DepositResponse,
  TopUpInitiation,
  TopUpOptions,
  TopUpStatus,
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
  /** Starts a Paystack hosted-checkout card top-up; the wallet is credited only after verification. */
  startTopUp: (amountCents: number, idempotencyKey: string) =>
    client.request<{ data: TopUpInitiation }>('/wallet/top-ups', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ amountCents }),
    }),
  topUpStatus: (reference: string) =>
    client.request<{ data: TopUpStatus }>(`/wallet/top-ups/${encodeURIComponent(reference)}`),
  /** Development/test only: the server answers 404 in production. */
  demoDeposit: (amountCents: number, idempotencyKey: string) =>
    client.request<{ data: DepositResponse }>('/wallet/deposits/demo', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ amountCents }),
    }),
});
