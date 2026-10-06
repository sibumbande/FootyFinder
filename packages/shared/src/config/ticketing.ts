/**
 * DEC-021 Match Ticketing (batch 5 brief, Part A). Every payment is a ticket for one named match; there is no
 * wallet. These are fixed product rules (approved smaller choice: constants, not environment settings).
 */
import { MATCH_FEE_CENTS } from '../types/payments.js';

/** A place is held for this long while its checkout runs ("Being booked", A1.2). */
export const TICKET_HOLD_MINUTES = 10;
/** Leaving more than this long before kick-off: choose 1 match credit or a refund; otherwise nothing (A2). */
export const TICKET_LEAVE_CUTOFF_HOURS = 24;
/** After a cancellation, a ticket holder who has not chosen is refunded automatically after this many days (A3). */
export const TICKET_CHOICE_DAYS = 7;
/** A match credit is valid for 3 years from issue (CPA s63; CEO D3). */
export const MATCH_CREDIT_VALID_YEARS = 3;
/** Team matches: the captain is alerted at T-4h if the team is not fully paid, and it is cancelled at T-2h (D1). */
export const TEAM_PAYMENT_ALERT_HOURS = 4;
export const TEAM_PAYMENT_CUTOFF_HOURS = 2;
/** Paystack references for ticket payments. */
export const TICKET_REFERENCE_PREFIX = 'ff_ticket_';
export const TICKET_REFERENCE_PATTERN = /^ff_ticket_[0-9a-f]{32}$/;

const HOUR = 3_600_000;

export const ticketHoldExpiresAt = (now: Date) => new Date(now.getTime() + TICKET_HOLD_MINUTES * 60_000);

/** What leaving gives back at this moment: the credit-or-refund choice (more than 24h before kick-off) or nothing. */
export const ticketLeaveOutcome = (startsAt: Date | string, now: Date = new Date()): 'CHOICE' | 'NOTHING' =>
  new Date(startsAt).getTime() - now.getTime() > TICKET_LEAVE_CUTOFF_HOURS * HOUR ? 'CHOICE' : 'NOTHING';

export const ticketChoiceDeadline = (from: Date) => new Date(from.getTime() + TICKET_CHOICE_DAYS * 24 * HOUR);

/** A credit's expiry: 3 years after it is issued (calendar years, never less than 3 x 365 days). */
export const matchCreditExpiresAt = (issuedAt: Date) => {
  const expires = new Date(issuedAt);
  expires.setUTCFullYear(expires.getUTCFullYear() + MATCH_CREDIT_VALID_YEARS);
  return expires;
};

export const teamPaymentAlertAt = (startsAt: Date) => new Date(startsAt.getTime() - TEAM_PAYMENT_ALERT_HOURS * HOUR);
export const teamPaymentCutoffAt = (startsAt: Date) => new Date(startsAt.getTime() - TEAM_PAYMENT_CUTOFF_HOURS * HOUR);

const rands = (cents: number) => `R${(cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;

/**
 * The cancellation policy in plain words, shown on the confirm sheet before paying, stored with the checkout as the
 * policy-acceptance record (A8, D15) and repeated in the ticket receipt email. It matches ToS clause 14.
 */
export function ticketCancellationPolicy(feeCents: number = MATCH_FEE_CENTS): string[] {
  return [
    `Leave more than ${TICKET_LEAVE_CUTOFF_HOURS} hours before kick-off and you choose: 1 match credit for any match, or a refund of ${rands(feeCents)} to the card or bank account you paid with.`,
    `Leave ${TICKET_LEAVE_CUTOFF_HOURS} hours or less before kick-off and nothing is refunded. Your place is released for someone else.`,
    'You can’t leave in the last 30 minutes before kick-off, when the lineup is locked.',
    `If the match is cancelled, you choose a match credit or a full refund. If you don’t choose within ${TICKET_CHOICE_DAYS} days, you’re refunded automatically.`,
  ];
}

/** The tick the player must give before paying (A1.1, A8). */
export const TICKET_POLICY_TICK = 'I understand the cancellation policy';
