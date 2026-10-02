import type { TeamSide } from './match.js';

/** DEC-021 Match Ticketing: a ticket is one place in one match for one named player. */
export type MatchTicketStatus = 'HELD' | 'CONFIRMED' | 'RELEASED' | 'CHOICE_PENDING' | 'CLOSED';
export type MatchTicketOutcome =
  | 'CREDIT_ISSUED'
  | 'REFUNDED'
  | 'CREDIT_RETURNED'
  | 'FORFEITED'
  | 'NOTHING_DUE'
  | 'LATE_PAYMENT_REFUNDED'
  | 'DUPLICATE_REFUNDED';
export type MatchTicketSeat = 'POSITION' | 'SUBSTITUTE' | 'TEAM';
export type TicketMethod = 'PAYMENT' | 'CREDIT' | 'FREE';

/** The result of starting a checkout. PROCESSING with an authorizationUrl means: go to Paystack's hosted checkout. */
export interface TicketCheckoutResult {
  checkoutId: string;
  matchId: string;
  method: TicketMethod;
  state: 'PROCESSING' | 'CONFIRMED' | 'FAILED' | 'EXPIRED';
  amountCents: number;
  reference?: string;
  authorizationUrl?: string;
  holdExpiresAt?: string;
  ticketIds: string[];
  /** Why a paid checkout did not end in a place (the payment is refunded automatically, A1.4). */
  refundReason?: string;
}

/** The viewer's own ticket for one match. */
export interface MyMatchTicket {
  id: string;
  status: MatchTicketStatus;
  seat: MatchTicketSeat;
  side: TeamSide;
  method: TicketMethod;
  amountCents: number;
  /** False when a teammate paid for this place (team matches); the refund or credit goes to them. */
  paidByMe: boolean;
  payerDisplayName?: string;
  holdExpiresAt?: string;
  choiceDeadlineAt?: string;
}

/** What the confirm and leave sheets need for one match. */
export interface MatchTicketContext {
  matchId: string;
  feeCents: number;
  ticket: MyMatchTicket | null;
  /** Match credits the viewer can use (1 credit = 1 ticket). */
  creditsAvailable: number;
  /** A payment of the viewer's is disputed (D9): they cannot buy tickets or use credits until it is resolved. */
  bookingRestricted: boolean;
  /** The cancellation policy in plain words, exactly as stored with the purchase. */
  policy: string[];
  /** What leaving gives back right now. */
  leave: { allowed: boolean; outcome: 'CHOICE' | 'NOTHING' | 'CREDIT_BACK'; reason?: 'LINEUP_LOCKED' | 'NOT_IN_MATCH' | 'MATCH_CLOSED' };
}

/** Places someone is paying for right now ("Being booked", A1.2), shown to everyone in the lobby. */
export interface MatchBookingHolds {
  slotIds: string[];
  substitutes: Record<TeamSide, number>;
}
