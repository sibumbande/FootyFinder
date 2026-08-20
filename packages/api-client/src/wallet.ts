import type { DepositResponse } from '@footy-finder/shared';
import type { ApiClient } from './client.js';

export const walletApi = (client: ApiClient) => ({
  demoDeposit: (idempotencyKey: string) =>
    client.request<{ data: DepositResponse }>('/wallet/deposits/demo', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
});
