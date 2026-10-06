/** DEC-018: platform-fixed Quick Match place fee (R80), paid by every joined player including subs. */
export const MATCH_FEE_CENTS = 8_000;
/** DEC-011: card top-ups are whole-rand ZAR amounts from R50 to R5,000. No withdrawals. */
export const TOP_UP_MIN_CENTS = 5_000;
export const TOP_UP_MAX_CENTS = 500_000;

/**
 * CEO touch-up batch 4, item 3 (D7): the Paystack checkout channels FootyFinder can offer, by Paystack's own codes.
 * Which ones are switched on is a server setting (PAYSTACK_CHANNELS); checkout shows exactly those. QR, USSD and
 * the rest are never offered.
 */
export const PAYMENT_CHANNELS = ['card', 'apple_pay', 'capitec_pay', 'eft'] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];
export const PAYMENT_CHANNEL_LABELS: Record<PaymentChannel, string> = {
  card: 'Card',
  apple_pay: 'Apple Pay',
  capitec_pay: 'Capitec Pay',
  eft: 'Instant EFT',
};
/** The player-facing name of a Paystack channel (unknown channels are shown as they are). */
export const paymentChannelLabel = (channel: string | null | undefined) =>
  channel ? (PAYMENT_CHANNEL_LABELS[channel as PaymentChannel] ?? channel) : null;

/**
 * TKT-604: a card top-up as the player sees it. PROCESSING covers "waiting for Paystack" and
 * "under finance review"; the wallet is credited only when our server has verified the payment.
 */
export type TopUpState = 'PROCESSING' | 'SUCCEEDED' | 'FAILED';

export interface TopUpStatus {
  reference: string;
  amountCents: number;
  currency: 'ZAR';
  state: TopUpState;
  underReview: boolean;
  createdAt: string;
}

export interface TopUpInitiation extends TopUpStatus {
  /** Paystack hosted checkout (checkout.paystack.com). Absent once the top-up is closed. */
  authorizationUrl?: string;
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
  | 'CARD_REFUND'
  | 'CARD_REFUND_REVERSED'
  | 'CHARGEBACK'
  | 'CHARGEBACK_REVERSED'
  | 'TEAM_CONTRIBUTION'
  | 'TEAM_REFUND'
  | 'LEGACY';

/**
 * TKT-606: the state of a refund to the player's card, kept separate from the wallet movement.
 * A failed refund stays FAILED for finance review; it is never silently turned into wallet credit.
 */
export type CardRefundState = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'RESTORED_TO_WALLET' | 'NEEDS_ATTENTION';

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
  related?: { type: 'match' | 'team'; id: string; name: string };
  /** Present on CARD_REFUND entries: where the money is on its way back to the card. */
  cardRefund?: { state: CardRefundState };
  /** CEO touch-up batch 4, item 3: how a top-up was paid (and so where its refund goes), e.g. "Capitec Pay". */
  paymentMethod?: string;
}

export interface WalletLedgerPage {
  entries: WalletLedgerEntry[];
  nextCursor: string | null;
}

export interface WalletReconciliationIssue {
  code: WalletReconciliationIssueCode;
  walletAccountId?: string;
  userId?: string;
  referenceId?: string;
  expectedCents?: number;
  actualCents?: number;
  /** Short machine-readable hint, never card or bank data. */
  detail?: string;
}

/**
 * TKT-609: every check the finance reconciliation runs. Wallet ledgers and holds (Slice 5),
 * provider payments, card refunds and chargebacks (Gate 6 personal payments), and
 * reservations, venue payables and settlement batches (Gate 6 settlement).
 */
export type WalletReconciliationIssueCode =
  | 'BALANCE_LEDGER_MISMATCH'
  | 'PAYMENT_LEDGER_MISSING'
  // CEO touch-up batch 3, item 5: free matches.
  | 'FREE_MATCH_PAYMENT_NOT_ZERO'
  | 'FREE_MATCH_COVER_MISSING'
  | 'FREE_MATCH_COVER_WITHOUT_PLAYER'
  | 'BOOKING_CONTRIBUTION_LEDGER_MISSING'
  | 'NEGATIVE_AVAILABLE_BALANCE'
  | 'TERMINAL_DEPOSIT_INCONSISTENT'
  | 'NEGATIVE_BALANCE_UNRESTRICTED'
  | 'TOP_UP_PENDING_TOO_LONG'
  | 'TOP_UP_UNDER_REVIEW'
  | 'TOP_UP_CREDIT_WITHOUT_VERIFIED_PAYMENT'
  | 'TOP_UP_SUCCEEDED_WITHOUT_CREDIT'
  | 'REFUND_LEDGER_MISMATCH'
  | 'REFUND_NEEDS_FINANCE'
  /** CEO batch 5, item 6: a deleted account's balance that no top-up could carry back (ToS 20.2). */
  | 'ACCOUNT_CLOSURE_UNREFUNDED'
  | 'REFUNDS_EXCEED_TOP_UP'
  | 'DISPUTE_LEDGER_MISMATCH'
  | 'PAYABLE_NOT_ELIGIBLE'
  | 'PAYABLE_AMOUNT_MISMATCH'
  | 'STARTED_MATCH_WITHOUT_PAYABLE'
  | 'LEGACY_RESERVATION_UNSETTLED'
  | 'SETTLEMENT_TOTAL_MISMATCH'
  | 'SETTLEMENT_PAYABLE_STATE_MISMATCH'
  // Gate 7 (TKT-701): team wallets.
  | 'TEAM_BALANCE_LEDGER_MISMATCH'
  | 'TEAM_NEGATIVE_AVAILABLE_BALANCE'
  | 'TEAM_CONTRIBUTION_LINK_MISMATCH'
  | 'TEAM_PROVENANCE_MISMATCH'
  | 'TEAM_ARCHIVED_WITH_FUNDS'
  // Gate 7 (TKT-709): fill meters.
  | 'TEAM_HOLD_ORPHANED'
  | 'TEAM_METER_OVERFUNDED'
  | 'TEAM_FEE_CAPTURE_MISMATCH';
export interface WalletReconciliationReport {
  generatedAt: string;
  walletCount: number;
  transactionCount: number;
  activeHoldCount: number;
  providerPaymentCount?: number;
  payableCount?: number;
  settlementBatchCount?: number;
  teamWalletCount?: number;
  issueCount: number;
  issues: WalletReconciliationIssue[];
}
