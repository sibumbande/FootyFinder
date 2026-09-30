import type { TeamSide } from './match.js';

/**
 * Gate 7 (DEC-014, DEC-019): Team Wallet contracts.
 * Members see the balance and each movement (amount, kind, time, contributor name). Only owners
 * and captains see actionable fill-meter holds. Internal references (idempotency keys, linked
 * ledger ids, provider data) are never exposed here, and no DTO ever carries a venue cost.
 */

/** D4: whole-rand contributions from R10 to R5,000, from the member's personal wallet. */
export const TEAM_CONTRIBUTION_MIN_CENTS = 1_000;
export const TEAM_CONTRIBUTION_MAX_CENTS = 500_000;
/** D4 abuse limits, per member per team, over a rolling 24 hours. */
export const TEAM_CONTRIBUTION_DAILY_MAX_CENTS = 500_000;
export const TEAM_CONTRIBUTION_DAILY_MAX_COUNT = 10;

export const TEAM_WALLET_HISTORY_DEFAULT_LIMIT = 20;
export const TEAM_WALLET_HISTORY_MAX_LIMIT = 50;

export interface TeamWalletSummary {
  teamId: string;
  balanceCents: number;
  heldCents: number;
  availableCents: number;
  currency: 'ZAR';
  /** The viewer's own contributions not yet spent (what they may self-refund, D8). */
  viewerUnspentCents: number;
  /** min(viewerUnspentCents, availableCents): held money cannot be refunded. */
  viewerRefundableCents: number;
  /** Owner or captain: may fill match meters and sees holds. */
  viewerCanManage: boolean;
  /** Current member: may contribute. */
  viewerCanContribute: boolean;
}

export type TeamWalletEntryKind =
  | 'CONTRIBUTION'
  | 'CONTRIBUTION_REFUND'
  | 'CLOSURE_REFUND'
  | 'TEAM_MATCH_FEE';

export interface TeamWalletEntry {
  id: string;
  kind: TeamWalletEntryKind;
  /** Signed: credits positive, debits negative. */
  amountCents: number;
  currency: 'ZAR';
  title: string;
  createdAt: string;
  /** Who put the money in or had it returned (contributions and refunds). */
  contributor?: { userId: string; displayName: string };
  related?: { type: 'match'; id: string; name: string };
}

export interface TeamWalletPage {
  entries: TeamWalletEntry[];
  nextCursor: string | null;
}

/** Owner/captain view of fill-meter money held for a match (D2/D3). */
export interface TeamWalletHoldView {
  id: string;
  match: { id: string; name: string; startsAt: string };
  side: TeamSide;
  amountCents: number;
  createdAt: string;
}

export interface TeamContributionResult {
  wallet: TeamWalletSummary;
  entry: TeamWalletEntry;
  replayed: boolean;
}

/** A team where the viewer still has unspent contributions (including teams they have left). */
export interface ReclaimableTeamContribution {
  team: { id: string; name: string; archived: boolean };
  unspentCents: number;
  refundableCents: number;
}

/**
 * Gate 7 / DEC-019 fill meter for one team's side of a team match, e.g. "R0 / R1,120". Each team
 * sees only its own meter. Before the other side is taken the meter is not active yet and only
 * the fee breakdown is shown. Never carries a venue cost.
 */
export interface TeamMeterView {
  matchId: string;
  side: TeamSide;
  teamId: string;
  teamName: string;
  starterCount: number;
  substituteCount: number;
  placeFeeCents: number;
  feeCents: number;
  heldCents: number;
  capturedCents: number;
  remainingCents: number;
  /** True once the other side is taken (a team loaded, or players joined). */
  active: boolean;
  /** From the T-30 go/no-go: no more filling or sub changes. */
  locked: boolean;
  full: boolean;
  /** Owner or captain of this side: may fill the meter and change subs. */
  viewerCanManage: boolean;
  /** Only for owners/captains: what the team wallet can still put in. */
  teamWalletAvailableCents?: number;
}
