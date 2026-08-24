import type { Match } from './match.js';
import type { PublicUser } from './user.js';

export type FieldReservationStatus = 'FUNDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
export interface BookingContribution {
  id: string;
  amountCents: number;
  status: 'HELD' | 'CAPTURED' | 'RELEASED';
  createdAt: string;
  user: PublicUser;
}
export interface FieldBooking {
  id: string;
  source: 'ADMIN_LOADED' | 'PLAYER_BOOKING';
  status: FieldReservationStatus;
  startsAt: string;
  endsAt: string;
  fundingDeadline?: string;
  priceCents: number;
  fundedCents: number;
  remainingCents: number;
  currency: 'ZAR';
  venueName: string;
  fieldName: string;
  address: string;
  city: string;
  match: Match;
  contributions: BookingContribution[];
  createdAt: string;
}
