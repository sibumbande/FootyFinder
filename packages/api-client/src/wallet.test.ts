import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { walletApi } from './wallet.js';

describe('walletApi', () => {
  it('reads the own-wallet summary and pages history with an encoded cursor', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = walletApi({ request } as unknown as ApiClient);

    await api.summary();
    await api.transactions();
    await api.transactions({ cursor: 'abc/+=', limit: 20 });

    expect(request).toHaveBeenNthCalledWith(1, '/wallet');
    expect(request).toHaveBeenNthCalledWith(2, '/wallet/transactions');
    expect(request).toHaveBeenNthCalledWith(3, '/wallet/transactions?cursor=abc%2F%2B%3D&limit=20');
  });

  it('sends the chosen top-up amount with the idempotency key', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = walletApi({ request } as unknown as ApiClient);
    await api.topUpOptions();
    await api.demoDeposit(16_000, 'key-1');
    expect(request).toHaveBeenNthCalledWith(1, '/wallet/top-up-options');
    expect(request).toHaveBeenNthCalledWith(2, '/wallet/deposits/demo', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-1' },
      body: JSON.stringify({ amountCents: 16_000 }),
    });
  });
});
