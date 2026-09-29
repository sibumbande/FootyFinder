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
});
