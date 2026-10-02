/**
 * CEO batch 5: self-service account deletion (ToS 20.1, 20.2) and the POPIA data download (ToS 8.7, 8.13).
 */
export const ACCOUNT_DELETION_GRACE_DAYS = 14;
export const DELETED_PLAYER_NAME = 'Deleted player';
export const DELETED_PLAYER_MESSAGE = 'Message from a deleted player';

export const ACCOUNT_DELETION_BLOCKER_CODES = [
  'ADMIN',
  'REFEREE',
  'ACCOUNT_RESTRICTED',
  'MATCH_LOCKED',
  'HOSTING_MATCH',
  'TEAM_OWNER_HAS_MEMBERS',
  'TEAM_OWNER_HAS_MONEY',
  'TEAM_OWNER_UPCOMING_MATCH',
  'OPEN_DISPUTE',
  'NEGATIVE_BALANCE',
  'REFUND_IN_PROGRESS',
  'TOP_UP_PENDING',
] as const;
export type AccountDeletionBlockerCode = (typeof ACCOUNT_DELETION_BLOCKER_CODES)[number];

export interface AccountDeletionBlocker {
  code: AccountDeletionBlockerCode;
  message: string;
  /** Where the player can fix it (a match, a team, the wallet), or null for "contact support". */
  targetPath: string | null;
}

export type AccountDeletionMatchOutcome =
  | 'FULL_REFUND'
  | 'NO_REFUND_UNLESS_REPLACED'
  | 'NOTHING_PAID'
  | 'LEFT_OUT_OF_SQUAD'
  | 'HOSTED_MATCH_CANCELLED';

export interface AccountDeletionMatchPlan {
  matchId: string;
  name: string;
  startsAt: string;
  outcome: AccountDeletionMatchOutcome;
  /** Credited to the Wallet straight away under clause 14.3 (0 when nothing comes back now). */
  creditCents: number;
}

export interface AccountDeletionTeamPlan {
  teamId: string;
  name: string;
  role: 'OWNER' | 'CAPTAIN' | 'MEMBER' | 'FORMER_MEMBER';
  /** LEAVE: membership removed at the final step. CLOSE: an empty team you own is closed. */
  outcome: 'LEAVE' | 'CLOSE';
  unspentContributionCents: number;
}

export interface AccountDeletionPreview {
  canDelete: boolean;
  blockers: AccountDeletionBlocker[];
  matches: AccountDeletionMatchPlan[];
  teams: AccountDeletionTeamPlan[];
  wallet: {
    balanceCents: number;
    heldCents: number;
    teamContributionsCents: number;
    /** Ways the player has paid ("card", "apple_pay", "capitec_pay", "eft"); refunds go back the same way. */
    paymentMethods: string[];
  };
  graceDays: number;
  /** When the final step would run if the player confirmed now. */
  scheduledFor: string;
}

export interface AccountDeletionScheduled {
  scheduledFor: string;
}

export const ACCOUNT_DELETION_STATUSES = ['BLOCKED', 'GRACE', 'WAITING', 'COMPLETED', 'CANCELLED'] as const;
export type AccountDeletionStatus = (typeof ACCOUNT_DELETION_STATUSES)[number];

/** CEO batch 5, item 4: the admin "Data retention" page. */
export interface RetentionRunSummary {
  id: string;
  mode: 'REPORT' | 'APPLY';
  trigger: string;
  counts: Record<string, number>;
  candidateCount: number;
  purgedCount: number;
  startedAt: string;
}
export interface RetentionCategorySummary {
  category: string;
  label: string;
  rule: string;
  mode: 'REPORT' | 'APPLY';
  reportOnly: boolean;
  runs: RetentionRunSummary[];
}
export interface RetentionOverview {
  categories: RetentionCategorySummary[];
}
