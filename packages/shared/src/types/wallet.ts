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

/** TKT-601: the caller's own wallet. `availableCents` = balance minus active holds. */
export interface WalletSummary {
  balanceCents: number;
  heldCents: number;
  availableCents: number;
  currency: 'ZAR';
  spendingRestricted: boolean;
}

/**
 * TKT-601: normalised, player-facing ledger kinds. LEGACY covers pre-master-domain rows.
 * Venue costs never appear here: every entry is the player's own wallet movement.
 */
export type WalletLedgerKind =
  | 'TOP_UP'
  | 'MATCH_FEE'
  | 'MATCH_REFUND'
  | 'LEAVE_CREDIT'
  | 'REPLACEMENT_CREDIT'
  | 'FIELD_BOOKING'
  | 'LEGACY';

export type WalletLedgerStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'ERROR';

export interface WalletLedgerEntry {
  id: string;
  kind: WalletLedgerKind;
  /** Signed: credits positive, debits negative. */
  amountCents: number;
  currency: 'ZAR';
  status: WalletLedgerStatus;
  /** Only SUCCEEDED entries count towards the balance. */
  countsTowardsBalance: boolean;
  title: string;
  createdAt: string;
  related?: { type: 'match'; id: string; name: string };
}

export interface WalletLedgerPage {
  entries: WalletLedgerEntry[];
  nextCursor: string | null;
}

export const WALLET_HISTORY_DEFAULT_LIMIT = 20;
export const WALLET_HISTORY_MAX_LIMIT = 50;

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
