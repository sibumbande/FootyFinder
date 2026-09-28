import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { venuesApi } from './venues.js';

describe('venuesApi', () => {
  it('encodes canonical venue slugs and slot query context', async () => {
    const request = vi.fn().mockResolvedValue({ data: [] });
    const api = venuesApi({ request } as unknown as ApiClient);

    await api.get('queens-park');
    await api.slots('queens-park', {
      fieldId: '11111111-1111-4111-8111-111111111111',
      format: 'FIVE_A_SIDE',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-02',
    });

    expect(request).toHaveBeenNthCalledWith(1, '/venues/queens-park');
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/venues/queens-park/slots?fieldId=11111111-1111-4111-8111-111111111111&format=FIVE_A_SIDE&dateFrom=2026-10-01&dateTo=2026-10-02',
    );
  });
});
