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
  'TEAM_OWNER_UPCOMING_MATCH',
  'OPEN_DISPUTE',
  'REFUND_IN_PROGRESS',
  /** DEC-021: a match ticket payment is still being confirmed with Paystack. */
  'PAYMENT_PENDING',
] as const;
export type AccountDeletionBlockerCode = (typeof ACCOUNT_DELETION_BLOCKER_CODES)[number];

export interface AccountDeletionBlocker {
  code: AccountDeletionBlockerCode;
  message: string;
  /** Where the player can fix it (a match, a team, Tickets & credits), or null for "contact support". */
  targetPath: string | null;
}

/**
 * DEC-021 D11, what happens to each upcoming match on confirm:
 * - REFUNDED: more than 24 hours before kick-off, a place you paid for is refunded to the card or bank you paid with;
 * - CREDIT_BACK: more than 24 hours before, a place paid with a match credit gives the credit back (then refunded or
 *   lapsing with your other credits);
 * - PAYER_CHOOSES: more than 24 hours before, a teammate paid for your place, and they choose a credit or a refund;
 * - FORFEITED: 24 hours or less before kick-off, nothing comes back;
 * - NOTHING_PAID: a free match.
 */
export type AccountDeletionMatchOutcome =
  | 'REFUNDED'
  | 'CREDIT_BACK'
  | 'PAYER_CHOOSES'
  | 'FORFEITED'
  | 'NOTHING_PAID'
  | 'LEFT_OUT_OF_SQUAD'
  | 'HOSTED_MATCH_CANCELLED';

export interface AccountDeletionMatchPlan {
  matchId: string;
  name: string;
  startsAt: string;
  outcome: AccountDeletionMatchOutcome;
  /** What is refunded to your card or bank for this match (REFUNDED only; 0 otherwise). */
  refundCents: number;
}

export interface AccountDeletionTeamPlan {
  teamId: string;
  name: string;
  role: 'OWNER' | 'CAPTAIN' | 'MEMBER' | 'FORMER_MEMBER';
  /** LEAVE: membership removed at the final step. CLOSE: an empty team you own is closed. */
  outcome: 'LEAVE' | 'CLOSE';
}

export interface AccountDeletionPreview {
  canDelete: boolean;
  blockers: AccountDeletionBlocker[];
  matches: AccountDeletionMatchPlan[];
  teams: AccountDeletionTeamPlan[];
  /**
   * DEC-021 D11: unused match credits. Those that came from a paid ticket are refunded (R80 each) to the payment
   * method of that ticket at the final step; credits with no cash origin (test or goodwill credits) lapse.
   */
  credits: {
    refunded: number;
    lapsing: number;
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
  matches: Array<{ matchId: string; name: string; startsAt: string; matchStatus: string; side: string; yourStatus: string; joinedAt: string; leftAt: string | null }>;
  results: Array<{ matchId: string; name: string; startsAt: string; side: string; role: string; didNotPlay: boolean; score: { home: number | null; away: number | null; outcome: string | null } | null }>;
  statistics: PlayerStatistics;
  /** DEC-021: match tickets you hold or paid for, with what happened to each. */
  tickets: Array<{ matchId: string; match: string; startsAt: string; seat: string; side: string; status: string; method: string; amountCents: number; outcome: string | null; forPlayer: string; paidBy: string; createdAt: string }>;
  matchCredits: Array<{ status: string; reason: string; issuedAt: string; expiresAt: string; usedAt: string | null }>;
  /** Your ticket payments, how they were paid and their refunds. Card and bank numbers are never held by FootyFinder. */
  payments: Array<{ reference: string; amountCents: number; status: string; method: string | null; createdAt: string; refunds: Array<{ amountCents: number; status: string; createdAt: string }> }>;
  /** DEC-021 D13: wallet and Team Wallet records from before match ticketing, kept read-only as history. */
  earlierPaymentRecords: {
    walletEntries: Array<{ type: string; amountCents: number; status: string; description: string | null; createdAt: string }>;
    topUps: Array<{ reference: string; amountCents: number; status: string; method: string | null; createdAt: string; refunds: Array<{ amountCents: number; status: string; createdAt: string }> }>;
    teamWalletEntries: Array<{ team: string; type: string; amountCents: number; createdAt: string }>;
  };
  teams: Array<{ teamId: string; name: string; role: string; joinedAt: string }>;
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
