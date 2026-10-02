import type { CardRefundState } from './wallet.js';

/** Gate 6 admin-only finance views. Never returned by player or host APIs. */
export type AdminTopUpStatus = 'INITIALIZED' | 'SUCCEEDED' | 'FAILED' | 'REVIEW';

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

export interface AdminTopUp {
  id: string;
  reference: string;
  player: { id: string; username: string; email: string };
  amountCents: number;
  status: AdminTopUpStatus;
  creditedBy?: string;
  providerStatus?: string;
  providerTransactionId?: string;
  failureReason?: string;
  reviewReason?: string;
  refundableCents: number;
  /** CEO touch-up batch 4, item 3: how it was paid (Paystack channel), e.g. "Capitec Pay". */
  paymentMethod?: string;
  refunds: AdminCardRefund[];
  disputes: AdminCardDispute[];
  createdAt: string;
}

/** CEO touch-up batch 4, item 3: a bank, for the "needs attention" refund form. */
export interface PaystackBankOption {
  id: string;
  name: string;
}

export interface AdminRestrictedWallet {
  userId: string;
  username: string;
  balanceCents: number;
  restrictedAt: string;
  reason?: string;
  openDisputes: number;
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
