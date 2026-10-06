import type { CardRefundState } from './payments.js';

/** Gate 6 admin-only finance views. Never returned by player or host APIs. */
export type AdminPaymentStatus = 'INITIALIZED' | 'SUCCEEDED' | 'FAILED' | 'REVIEW';

export interface AdminCardRefund {
  id: string;
  amountCents: number;
  state: CardRefundState;
  reason: string;
  failureReason?: string;
  reviewReason?: string;
  attempts: number;
  providerRefundId?: string;
  restoreReason?: string;
  /**
   * CEO batch 5: ADMIN, PLAYER_UNDO or ACCOUNT_CLOSURE (the final step of an account deletion). DEC-021: why a ticket
   * is refunded (left, match cancelled, no choice within 7 days, late payment, paid twice).
   */
  source?: 'ADMIN' | 'PLAYER_UNDO' | 'ACCOUNT_CLOSURE' | 'TICKET_LEFT' | 'MATCH_CANCELLED' | 'CHOICE_TIMEOUT' | 'LATE_PAYMENT' | 'DUPLICATE_PAYMENT';
  /** DEC-021: the ticket this refund is for (and the match), when it is a ticket refund. */
  ticketId?: string;
  matchId?: string;
  createdAt: string;
}

export interface AdminCardDispute {
  id: string;
  providerDisputeId: string;
  status: 'OPEN' | 'WON' | 'LOST';
  amountCents: number;
  resolution?: string;
  openedAt: string;
  resolvedAt?: string;
}

/**
 * A provider payment as finance sees it: a match ticket payment (DEC-021; one payment can cover several tickets and
 * is refunded per ticket by the ticket rules), or an earlier payment record from before DEC-021 (read-only).
 */
export interface AdminPayment {
  id: string;
  reference: string;
  player: { id: string; username: string; email: string };
  amountCents: number;
  status: AdminPaymentStatus;
  creditedBy?: string;
  providerStatus?: string;
  providerTransactionId?: string;
  failureReason?: string;
  reviewReason?: string;
  /** CEO touch-up batch 4, item 3: how it was paid (Paystack channel), e.g. "Capitec Pay". */
  paymentMethod?: string;
  /** DEC-021: TICKETS, or TOP_UP for an earlier payment record from before DEC-021. */
  purpose: 'TOP_UP' | 'TICKETS';
  /** The match a ticket payment was for. */
  match?: { id: string; name: string; startsAt: string };
  ticketCount?: number;
  refunds: AdminCardRefund[];
  disputes: AdminCardDispute[];
  createdAt: string;
  /**
   * CEO batch 5, item 6 (D2): the player deleted their account; finance contacts them at this address (kept
   * only until the closure refunds are settled).
   */
  accountClosure?: { requestId: string; contactEmail: string | null };
}

/** CEO batch 5, item 6: the admin "Deletion requests" page. */
export interface AdminAccountDeletionRequest {
  id: string;
  /** The account's id (the anonymous ID once deleted). */
  userId: string;
  status: 'BLOCKED' | 'GRACE' | 'WAITING' | 'COMPLETED' | 'CANCELLED';
  /** The player's name while the account still exists; "Deleted player" once anonymised. */
  displayName: string;
  requestedAt: string;
  scheduledFor: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  blockedReasons: string[];
  waitingReason: string | null;
  lastCheckedAt: string | null;
  refunds: Array<{ refundId: string | null; amountCents: number; method: string | null; status: string }>;
  uncoveredCents: number;
  /** DEC-021 D11: unused match credits refunded (they came from a paid ticket) and lapsed (no cash origin). */
  creditsRefunded: number;
  creditsLapsed: number;
  contactEmail: string | null;
  finalEmailSentAt: string | null;
  financeSettledAt: string | null;
  financeNote: string | null;
}

/** CEO touch-up batch 4, item 3: a bank, for the "needs attention" refund form. */
export interface PaystackBankOption {
  id: string;
  name: string;
}

/**
 * DEC-021 A8 / D9: a payment the payer disputed with their bank. While it is open the payer can't buy tickets or use
 * match credits (their tickets stay valid). Won: the restriction lifts by itself. Lost: an admin lifts it.
 */
export interface AdminPaymentDispute {
  id: string;
  providerDisputeId: string;
  status: 'OPEN' | 'WON' | 'LOST';
  amountCents: number;
  reference: string;
  purpose: 'TOP_UP' | 'TICKETS';
  payer: {
    userId: string;
    username: string;
    displayName?: string;
    bookingRestrictedAt?: string;
    bookingRestrictionReason?: string;
  };
  ticketCount: number;
  matchName?: string;
  matchStartsAt?: string;
  openedAt: string;
  dueAt?: string;
  resolvedAt?: string;
  resolution?: string;
}

export type EvidenceAttendance = 'PLAYED' | 'DID_NOT_PLAY' | 'NOT_RECORDED' | 'MATCH_NOT_PLAYED';

/** DEC-021 A8: everything we hold about a disputed payment, to contest it with the bank (JSON and printable). */
export interface PaymentDisputeEvidencePack {
  generatedAt: string;
  dispute: AdminPaymentDispute;
  payment: {
    reference: string;
    amountCents: number;
    currency: string;
    channel?: string;
    createdAt: string;
    verifiedAt?: string;
    confirmedBy?: string;
  };
  payer: { userId: string; username: string; displayName?: string; email: string };
  policyAcceptance?: {
    acceptedAt: string;
    termsVersion: string;
    policyText: string;
    ipAddress?: string;
    userAgent?: string;
  };
  tickets: Array<{
    id: string;
    playerDisplayName: string;
    seat: string;
    side: string;
    status: string;
    outcome?: string;
    amountCents: number;
    confirmedAt?: string;
    closedAt?: string;
    closedReason?: string;
    attendance: EvidenceAttendance;
    match: {
      id: string;
      name: string;
      venueName: string;
      startsAt: string;
      status: string;
      cancelledAt?: string;
      cancellationReason?: string;
    };
  }>;
  emails: Array<{ kind: string; subject: string; sentAt: string; recipientDisplayName?: string }>;
  refunds: Array<{ id: string; amountCents: number; status: string; source: string; reason: string; createdAt: string; processedAt?: string }>;
  creditEvents: Array<{ ticketId: string; type: string; at: string }>;
}

/** Gate 6 / TKT-607: venue bank details. Admin-only; returned in full only by the audited reveal. */
export type BankAccountType = 'CHEQUE' | 'SAVINGS' | 'TRANSMISSION';

export interface VenueBankDetails {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  branchCode: string;
  accountType: BankAccountType;
}

export interface AdminVenueBeneficiary {
  id: string;
  venueId: string;
  displayName: string;
  /** Masked: only the last four digits of the account number. */
  accountLast4: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'RETIRED';
  linkedUserId?: string;
  createdByUserId: string;
  approvedByUserId?: string;
  approvedAt?: string;
  createdAt: string;
}

export type VenuePayableStatus = 'DUE' | 'IN_BATCH' | 'PAID' | 'VOID';

export interface AdminVenuePayable {
  id: string;
  reservationId: string;
  matchId: string;
  matchName: string;
  kickoffAt: string;
  venue: { id: string; name: string };
  amountCents: number;
  adjustmentsCents: number;
  status: VenuePayableStatus;
  dueAt: string;
  paidAt?: string;
  adjustments: Array<{ id: string; amountCents: number; reason: string; actorUserId: string; createdAt: string }>;
}

/** Gate 6 / TKT-608: what is waiting to be settled per venue (admin-only). */
export interface AdminSettlementDue {
  venue: { id: string; name: string };
  payableCount: number;
  payablesCents: number;
  unappliedAdjustmentsCents: number;
  oldestDueAt?: string;
  approvedBeneficiary?: AdminVenueBeneficiary;
  /** Monday (YYYY-MM-DD, Johannesburg) of the latest closed week that can be prepared. */
  latestClosedWeek: string;
}

export type SettlementBatchStatus = 'PREPARED' | 'APPROVED' | 'PAID' | 'CANCELLED';

export interface AdminSettlementBatch {
  id: string;
  venue: { id: string; name: string };
  beneficiary: AdminVenueBeneficiary;
  periodStart: string;
  periodEnd: string;
  payablesCents: number;
  adjustmentsCents: number;
  totalCents: number;
  status: SettlementBatchStatus;
  preparedByUserId: string;
  preparedAt: string;
  approvedByUserId?: string;
  approvedAt?: string;
  paidByUserId?: string;
  paidAt?: string;
  payoutReference?: string;
  evidenceNote?: string;
  cancelledByUserId?: string;
  cancelReason?: string;
  payables: AdminVenuePayable[];
}

/**
 * DEC-021 A6: ticket reconciliation (replaces wallet reconciliation). Read-only; every issue is for finance review.
 * Every confirmed ticket has a verified provider payment, a used match credit or an R0 free-match reason; every
 * refund matches a provider refund event; credits issued = used + expired + forfeited + refunded + outstanding.
 * Venue payables and settlement batches are checked as before.
 */
export type TicketReconciliationIssueCode =
  | 'TICKET_PAYMENT_UNVERIFIED'
  | 'TICKET_CREDIT_MISSING'
  | 'TICKET_FREE_NOT_ZERO'
  | 'CHECKOUT_AMOUNT_MISMATCH'
  | 'PAID_TICKET_NOT_PLACED_OR_REFUNDED'
  | 'TICKET_PAYMENT_UNDER_REVIEW'
  | 'TICKET_HOLD_OVERDUE'
  | 'TICKET_CHOICE_OVERDUE'
  | 'TICKET_REFUND_MISSING'
  | 'REFUND_AMOUNT_MISMATCH'
  | 'REFUND_WITHOUT_PROVIDER_EVENT'
  | 'REFUND_PENDING_TOO_LONG'
  | 'REFUND_NEEDS_FINANCE'
  | 'REFUNDS_EXCEED_PAYMENT'
  | 'CREDIT_LEDGER_MISMATCH'
  | 'CREDIT_SOURCE_MISSING'
  | 'CREDIT_EXPIRY_OVERDUE'
  | 'FREE_MATCH_COVER_MISSING'
  | 'FREE_MATCH_COVER_WITHOUT_PLAYER'
  /** CEO batch 5, item 6: money of a deleted account that finance still has to return (ToS 20.2). */
  | 'ACCOUNT_CLOSURE_UNREFUNDED'
  | 'PAYABLE_NOT_ELIGIBLE'
  | 'PAYABLE_AMOUNT_MISMATCH'
  | 'STARTED_MATCH_WITHOUT_PAYABLE'
  | 'LEGACY_RESERVATION_UNSETTLED'
  | 'SETTLEMENT_TOTAL_MISMATCH'
  | 'SETTLEMENT_PAYABLE_STATE_MISMATCH';

export interface TicketReconciliationIssue {
  code: TicketReconciliationIssueCode;
  userId?: string;
  /** The ticket, payment, refund, credit, match, payable or batch the issue is about. */
  referenceId?: string;
  expectedCents?: number;
  actualCents?: number;
  /** Short machine-readable hint, never card or bank data. */
  detail?: string;
}

export interface TicketReconciliationReport {
  generatedAt: string;
  ticketCount: number;
  paymentCount: number;
  refundCount: number;
  /** Counted in matches, never rands: issued = used + expired + forfeited + refunded + outstanding. */
  credits: { issued: number; used: number; expired: number; forfeited: number; refunded: number; outstanding: number };
  payableCount: number;
  settlementBatchCount: number;
  issueCount: number;
  issues: TicketReconciliationIssue[];
}
