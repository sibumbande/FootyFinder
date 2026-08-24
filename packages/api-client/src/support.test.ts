import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { supportApi } from './support.js';

describe('supportApi', () => {
  it('uses only the authenticated user ticket boundary', async () => {
    const request = vi.fn().mockResolvedValue({ data: [] });
    const api = supportApi({ request } as unknown as ApiClient);
    await api.list();
    await api.create({ subject: 'Account help', category: 'ACCOUNT', message: 'Please help with my account.' });
    await api.get('ticket-id');
    await api.reply('ticket-id', { content: 'Here is more information.' });
    expect(request.mock.calls.map(([path]) => path)).toEqual(['/support/tickets', '/support/tickets', '/support/tickets/ticket-id', '/support/tickets/ticket-id/messages']);
  });
});
