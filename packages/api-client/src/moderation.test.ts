import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { moderationApi } from './moderation.js';

describe('moderationApi', () => {
  it('uses the authenticated player report contracts', async () => {
    const request = vi.fn().mockResolvedValue({ data: [] });
    const api = moderationApi({ request } as unknown as ApiClient);
    await api.reports();
    await api.createReport({
      targetType: 'DIRECT_MESSAGE',
      targetId: '11111111-1111-4111-8111-111111111111',
      reason: 'HARASSMENT',
      details: 'Repeated abuse.',
    });
    expect(request).toHaveBeenNthCalledWith(1, '/moderation/reports');
    expect(request).toHaveBeenNthCalledWith(2, '/moderation/reports', {
      method: 'POST',
      body: JSON.stringify({
        targetType: 'DIRECT_MESSAGE',
        targetId: '11111111-1111-4111-8111-111111111111',
        reason: 'HARASSMENT',
        details: 'Repeated abuse.',
      }),
    });
  });
});
