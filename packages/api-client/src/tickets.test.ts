import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { ticketsApi } from './tickets.js';

describe('ticketsApi', () => {
  it('reads the viewer\'s tickets, credits and refunds (DEC-021 "Tickets & credits")', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = ticketsApi({ request } as unknown as ApiClient);
    await api.mine();
    await api.checkoutStatusByReference('ref/1');
    expect(request.mock.calls.map(([path]) => path)).toEqual(['/tickets/mine', '/tickets/checkouts/by-reference/ref%2F1']);
  });
});
