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
/** Leaving: what happened to the place. PAYER_CHOOSES: a teammate paid, and they choose a credit or a refund. */
export interface TicketLeaveResult {
  outcome: MatchTicketOutcome | 'PAYER_CHOOSES';
}
export type MatchTicketSeat = 'POSITION' | 'SUBSTITUTE' | 'TEAM';
export type TicketMethod = 'PAYMENT' | 'CREDIT' | 'FREE';

/** The result of starting a checkout. PROCESSING with an authorizationUrl means: go to the provider's hosted checkout. */
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
  /** Whose secure page a card payment is made on in this environment (absent: none, or the demo operator). */
  paymentProvider?: 'paystack' | 'payfast';
  /** The cancellation policy in plain words, exactly as stored with the purchase. */
  policy: string[];
  /** DEC-021 A3: the viewer's places (as payer) in this cancelled match that still need a credit-or-refund choice. */
  pendingChoices: Array<{ ticketId: string; playerDisplayName: string; amountCents: number; choiceDeadlineAt: string }>;
  /** What leaving gives back right now. */
  leave: { allowed: boolean; outcome: 'CHOICE' | 'NOTHING' | 'CREDIT_BACK'; reason?: 'LINEUP_LOCKED' | 'NOT_IN_MATCH' | 'MATCH_CLOSED' };
}

/** Places someone is paying for right now ("Being booked", A1.2), shown to everyone in the lobby. */
export interface MatchBookingHolds {
  slotIds: string[];
  substitutes: Record<TeamSide, number>;
}

/** DEC-021 A5: one squad member on a team's payment checklist. */
export interface TeamPaymentMember {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  /** Picked in the team's lineup for this match (starters and subs are listed first). */
  lineupRole: 'STARTER' | 'SUBSTITUTE' | null;
  status: 'PAID' | 'BEING_PAID' | 'UNPAID';
  /** Who paid (shown as "Paid by Thabo"). */
  paidByDisplayName?: string;
  paidByMe?: boolean;
  isMe: boolean;
}

/** DEC-021 A5: a team's payment checklist for one match ("11 of 14 paid · R240 still needed"). */
export interface TeamPaymentRoster {
  matchId: string;
  side: TeamSide;
  teamName: string;
  /** Places to pay for: the format's starters plus the team's chosen subs. */
  seats: number;
  paidSeats: number;
  placeFeeCents: number;
  stillNeededCents: number;
  /** T-4h: the captain is alerted if the team isn't fully paid. T-2h: the fixture is cancelled if it still isn't (D1). */
  alertAt: string;
  cutoffAt: string;
  /** Payments are open (the other side is taken, before the T-2h cutoff, match open). */
  open: boolean;
  closedReason?: 'OPPONENT_NOT_FOUND' | 'CUTOFF_PASSED' | 'MATCH_CLOSED';
  viewerCreditsAvailable: number;
  viewerCanManage: boolean;
  members: TeamPaymentMember[];
}

/** DEC-021 "Tickets & credits": one ticket the viewer holds or paid for. */
export interface MyTicketRow {
  id: string;
  matchId: string;
  matchName: string;
  venueName: string;
  startsAt: string;
  matchStatus: string;
  seat: MatchTicketSeat;
  side: TeamSide;
  status: MatchTicketStatus;
  method: TicketMethod;
  amountCents: number;
  outcome?: MatchTicketOutcome;
  /** The ticket is for this player (a teammate, when the viewer paid for them). */
  playerDisplayName: string;
  isMine: boolean;
  paidByMe: boolean;
  payerDisplayName?: string;
  /** "Card", "Instant EFT", … for a paid ticket. */
  paymentMethodLabel?: string;
  choiceDeadlineAt?: string;
}

export interface MyMatchCredit {
  id: string;
  status: 'AVAILABLE' | 'USED' | 'EXPIRED' | 'FORFEITED' | 'REFUNDED';
  reason: 'LEFT_MATCH' | 'MATCH_CANCELLED' | 'CREDIT_RETURNED' | 'DEV_SEED' | 'GOODWILL';
  issuedAt: string;
  /** "Valid until 2 Oct 2029". */
  expiresAt: string;
  usedAt?: string;
  usedOnMatchName?: string;
}

export interface MyTicketRefund {
  id: string;
  amountCents: number;
  /** In progress, refunded, or (needs bank details / failed) being handled by support. */
  state: 'IN_PROGRESS' | 'REFUNDED' | 'NEEDS_BANK_DETAILS' | 'HANDLED_BY_SUPPORT';
  matchName?: string;
  paymentMethodLabel?: string;
  createdAt: string;
  processedAt?: string;
}

/** DEC-021 "Tickets & credits": upcoming and past tickets, credits with expiry, refunds and their status. */
export interface MyTicketsOverview {
  upcoming: MyTicketRow[];
  past: MyTicketRow[];
  creditsAvailable: number;
  credits: MyMatchCredit[];
  refunds: MyTicketRefund[];
  bookingRestricted: boolean;
}
