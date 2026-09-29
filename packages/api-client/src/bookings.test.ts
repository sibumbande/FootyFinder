import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { bookingsApi } from './bookings.js';

describe('bookingsApi', () => {
  it('exposes read-only booking history routes', async () => {
    const request = vi.fn().mockResolvedValue({ data: [] });
    const api = bookingsApi({ request } as unknown as ApiClient);
    await api.list();
    await api.get('booking-id');
    expect(request.mock.calls.map(([path]) => path)).toEqual(['/bookings', '/bookings/booking-id']);
  });

  it('no longer offers the retired player funding calls (DEC-018)', () => {
    const api = bookingsApi({ request: vi.fn() } as unknown as ApiClient);
    expect(Object.keys(api).sort()).toEqual(['get', 'list']);
  });
});
