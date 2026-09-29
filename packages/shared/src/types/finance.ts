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
  refunds: AdminCardRefund[];
  disputes: AdminCardDispute[];
  createdAt: string;
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
