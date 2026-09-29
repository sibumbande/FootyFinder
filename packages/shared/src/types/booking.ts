import type { Match } from './match.js';
import type { PublicUser } from './user.js';

export type FieldReservationStatus = 'FUNDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
/** Player-facing contribution record: who took part, never how much (DEC-018). */
export interface BookingContribution {
  id: string;
  status: 'HELD' | 'CAPTURED' | 'RELEASED';
  createdAt: string;
  user: PublicUser;
}
/**
 * Player-facing booking history. DEC-018: carries no venue cost, funding totals, or contribution
 * amounts. Admin tools use AdminFieldBooking instead.
 */
export interface FieldBooking {
  id: string;
  source: 'ADMIN_LOADED' | 'PLAYER_BOOKING';
  status: FieldReservationStatus;
  startsAt: string;
  endsAt: string;
  fundingDeadline?: string;
  venueName: string;
  fieldName: string;
  address: string;
  city: string;
  match: Match;
  contributions: BookingContribution[];
  createdAt: string;
}

export interface AdminBookingContribution extends BookingContribution {
  amountCents: number;
}
/** ADMIN-ONLY booking view, including the venue cost snapshot. Never returned to players or hosts. */
export interface AdminFieldBooking extends Omit<FieldBooking, 'contributions'> {
  priceCents: number;
  fundedCents: number;
  remainingCents: number;
  currency: 'ZAR';
  contributions: AdminBookingContribution[];
}
