import type { FieldBooking } from '@footy-finder/shared';
import type { ApiClient } from './client.js';

/**
 * Player booking history only. DEC-018 retired player field-booking creation and pooled
 * contributions (the API answers 410 PLAYER_FIELD_BOOKING_RETIRED), and FieldBooking carries no
 * venue cost.
 */
export const bookingsApi = (client: ApiClient) => ({
  list: () => client.request<{ data: FieldBooking[] }>('/bookings'),
  get: (bookingId: string) => client.request<{ data: FieldBooking }>(`/bookings/${bookingId}`),
});
