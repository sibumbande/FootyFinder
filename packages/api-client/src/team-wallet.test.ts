import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { teamWalletApi } from './team-wallet.js';

describe('teamWalletApi', () => {
  it('reads the team wallet, pages its history and lists holds', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = teamWalletApi({ request } as unknown as ApiClient);
    await api.summary('team-1');
    await api.transactions('team-1');
    await api.transactions('team-1', { cursor: 'a/b', limit: 20 });
    await api.holds('team-1');
    await api.reclaimable();
    expect(request).toHaveBeenNthCalledWith(1, '/teams/team-1/wallet');
    expect(request).toHaveBeenNthCalledWith(2, '/teams/team-1/wallet/transactions');
    expect(request).toHaveBeenNthCalledWith(3, '/teams/team-1/wallet/transactions?cursor=a%2Fb&limit=20');
    expect(request).toHaveBeenNthCalledWith(4, '/teams/team-1/wallet/holds');
    expect(request).toHaveBeenNthCalledWith(5, '/wallet/team-contributions');
  });

  it('sends contributions and refunds with an idempotency key', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = teamWalletApi({ request } as unknown as ApiClient);
    await api.contribute('team-1', 50_000, 'key-1');
    await api.refund('team-1', 10_000, 'key-2');
    expect(request).toHaveBeenNthCalledWith(1, '/teams/team-1/wallet/contributions', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-1' },
      body: JSON.stringify({ amountCents: 50_000 }),
    });
    expect(request).toHaveBeenNthCalledWith(2, '/teams/team-1/wallet/refunds', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-2' },
      body: JSON.stringify({ amountCents: 10_000 }),
    });
  });
});
