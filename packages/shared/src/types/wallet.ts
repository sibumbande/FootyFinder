import type { AuthenticatedUser } from './user.js';

/** DEC-018: platform-fixed Quick Match place fee (R80), paid by every joined player including subs. */
export const MATCH_FEE_CENTS = 8_000;
export const DEMO_DEPOSIT_CENTS = 50_000;

export type DepositStatus = 'success' | 'failure' | 'error';

export interface DepositResponse {
  status: DepositStatus;
  transactionId: string;
  user?: AuthenticatedUser;
  message?: string;
  replayed?: boolean;
}

export interface WalletHold {
  id: string;
  amountCents: number;
  currency: 'ZAR';
  status: 'ACTIVE' | 'CAPTURED' | 'RELEASED' | 'EXPIRED';
  referenceType: string;
  referenceId: string;
  expiresAt?: string;
  createdAt: string;
}

export interface WalletReconciliationIssue {
  code: 'BALANCE_LEDGER_MISMATCH' | 'PAYMENT_LEDGER_MISSING' | 'BOOKING_CONTRIBUTION_LEDGER_MISSING' | 'NEGATIVE_AVAILABLE_BALANCE' | 'TERMINAL_DEPOSIT_INCONSISTENT';
  walletAccountId?: string;
  userId?: string;
  referenceId?: string;
  expectedCents?: number;
  actualCents?: number;
}
export interface WalletReconciliationReport {
  generatedAt: string;
  walletCount: number;
  transactionCount: number;
  activeHoldCount: number;
  issueCount: number;
  issues: WalletReconciliationIssue[];
}
