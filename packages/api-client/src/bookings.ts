import type { BookingContributionInput, FieldBooking, ManagedVenue, PlayerFieldBookingInput } from '@footy-finder/shared';
import type { ApiClient } from './client.js';

export const bookingsApi = (client: ApiClient) => ({
  fields: () => client.request<{ data: ManagedVenue[] }>('/bookings/fields'),
  list: () => client.request<{ data: FieldBooking[] }>('/bookings'),
  create: (input: PlayerFieldBookingInput) => client.request<{ data: FieldBooking }>('/bookings', { method: 'POST', body: JSON.stringify(input) }),
  get: (bookingId: string) => client.request<{ data: FieldBooking }>(`/bookings/${bookingId}`),
  contribute: (bookingId: string, input: BookingContributionInput, idempotencyKey: string) => client.request<{ data: FieldBooking }>(`/bookings/${bookingId}/contributions`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input) }),
});
