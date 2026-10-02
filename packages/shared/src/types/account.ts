import type { PlayerStatistics } from './user.js';
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

/** CEO batch 5, item 5: "Download my data" (POPIA section 23; ToS 8.7 and 8.13). */
export interface PersonalDataExport {
  format: 'footyfinder-personal-data';
  version: 1;
  generatedAt: string;
  about: string;
  account: {
    id: string;
    email: string;
    username: string;
    createdAt: string;
    emailVerifiedAt: string | null;
    onboardingCompletedAt: string | null;
    accountStatus: string;
    friendRequestsEnabled: boolean;
  };
  profile: {
    displayName: string | null;
    bio: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    city: string | null;
    homeArea: string | null;
    dominantFoot: string | null;
    yearsExperience: number | null;
    preferredPositions: string[];
    photo: { uploadedAt: string; hiddenByFootyFinder: boolean } | null;
  };
  matches: Array<{ matchId: string; name: string; startsAt: string; matchStatus: string; side: string; yourStatus: string; joinedAt: string; leftAt: string | null; paidCents: number }>;
  results: Array<{ matchId: string; name: string; startsAt: string; side: string; role: string; didNotPlay: boolean; score: { home: number | null; away: number | null; outcome: string | null } | null }>;
  statistics: PlayerStatistics;
  wallet: {
    balanceCents: number;
    transactions: Array<{ type: string; amountCents: number; status: string; description: string | null; createdAt: string }>;
    topUps: Array<{ reference: string; amountCents: number; status: string; method: string | null; createdAt: string; refunds: Array<{ amountCents: number; status: string; createdAt: string }> }>;
  };
  teams: Array<{ teamId: string; name: string; role: string; joinedAt: string }>;
  teamWalletContributions: Array<{ team: string; type: string; amountCents: number; createdAt: string }>;
  friends: Array<{ displayName: string; since: string }>;
  friendRequests: Array<{ direction: 'SENT' | 'RECEIVED'; otherPlayer: string; status: string; createdAt: string }>;
  blockedPlayers: Array<{ displayName: string; since: string }>;
  messagesSent: {
    direct: Array<{ conversationId: string; content: string; sentAt: string }>;
    lobbyChat: Array<{ matchId: string; content: string; sentAt: string }>;
    teamChat: Array<{ teamId: string; content: string; sentAt: string }>;
  };
  teamReviews: Array<{ team: string; match: string; rating: number; comment: string | null; status: string; createdAt: string }>;
  recruitment: {
    lookingCard: Record<string, unknown> | null;
    joinRequests: Array<{ team: string; status: string; createdAt: string }>;
    postsCreated: Array<{ team: string; status: string; area: string; note: string | null; createdAt: string }>;
  };
  consents: { cityWaitingList: Array<{ city: string; email: string; source: string; consentedAt: string; unsubscribedAt: string | null }> };
  termsAcceptances: Array<{ document: string; type: string; version: string; acceptedAt: string; source: string; evidence: unknown }>;
  deletionRequests: Array<{ status: string; requestedAt: string; scheduledFor: string | null; cancelledAt: string | null }>;
}
