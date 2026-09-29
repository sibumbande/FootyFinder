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
