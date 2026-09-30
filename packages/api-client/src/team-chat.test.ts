import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { teamChatApi } from './team-chat.js';

describe('teamChatApi', () => {
  it('pages history, sends and marks read', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = teamChatApi({ request } as unknown as ApiClient);
    await api.history('team-1');
    await api.history('team-1', { before: 'a/b', limit: 30 });
    await api.send('team-1', 'Kick-off 7pm');
    await api.markRead('team-1');
    expect(request).toHaveBeenNthCalledWith(1, '/teams/team-1/chat/messages');
    expect(request).toHaveBeenNthCalledWith(2, '/teams/team-1/chat/messages?before=a%2Fb&limit=30');
    expect(request).toHaveBeenNthCalledWith(3, '/teams/team-1/chat/messages', { method: 'POST', body: JSON.stringify({ content: 'Kick-off 7pm' }) });
    expect(request).toHaveBeenNthCalledWith(4, '/teams/team-1/chat/read', { method: 'POST' });
  });
});
