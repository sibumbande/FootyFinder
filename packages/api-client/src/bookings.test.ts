import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { bookingsApi } from './bookings.js';

describe('bookingsApi', () => {
  it('uses typed field, booking, and idempotent contribution routes', async () => {
    const request = vi.fn().mockResolvedValue({ data: [] });
    const api = bookingsApi({ request } as unknown as ApiClient);
    const input = { managedFieldId: '11111111-1111-4111-8111-111111111111', name: 'Friday Football', format: 'FIVE_A_SIDE' as const, substituteCapacityPerTeam: 5, rollingSubstitutes: true, rules: [], visibility: 'PUBLIC' as const, startsAt: '2026-09-01T18:00:00.000Z' };
    await api.fields(); await api.list(); await api.create(input); await api.get('booking-id'); await api.contribute('booking-id', { amountCents: 20_000 }, 'contribution-key');
    expect(request.mock.calls.map(([path]) => path)).toEqual(['/bookings/fields', '/bookings', '/bookings', '/bookings/booking-id', '/bookings/booking-id/contributions']);
    expect(request).toHaveBeenLastCalledWith('/bookings/booking-id/contributions', { method: 'POST', headers: { 'Idempotency-Key': 'contribution-key' }, body: JSON.stringify({ amountCents: 20_000 }) });
  });
});
