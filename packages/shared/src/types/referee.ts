import type { AccountStatus } from './user.js';
import type { MatchFormat } from '../config/match-formats.js';
import type { MatchMode, MatchStatus } from './match.js';

/** Gate 8 / DEC-020: a FootyFinder referee as the admin dashboard lists them. Admin-only. */
export interface AdminReferee {
  userId: string;
  displayName: string;
  username: string;
  email: string;
  accountStatus: AccountStatus;
  grantedAt: string;
  grantReason: string;
  grantedBy?: { id: string; displayName: string } | null;
}

/** The referee shown on a match page (D18): display name only. */
export interface MatchReferee {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
}

export type RefereeAssignmentAction = 'ASSIGNED' | 'AUTO_ASSIGNED' | 'REMOVED' | 'DECLINED' | 'ROLE_REVOKED';

export interface RefereeAssignmentHistoryEntry {
  id: string;
  action: RefereeAssignmentAction;
  referee: { id: string; displayName: string };
  actor?: { id: string; displayName: string } | null;
  reason?: string | null;
  createdAt: string;
}

/** Gate 8 / TKT-803: one player in a match lineup (the kickoff record, or the live lineup before). */
export interface MatchLineupPlayer {
  userId: string;
  displayName: string;
  side: 'HOME' | 'AWAY';
  role: 'STARTER' | 'SUBSTITUTE';
  slotIndex: number | null;
  didNotPlay: boolean;
}

/** Gate 8 / TKT-802: one refereed match in the admin assignment views. Admin-only. */
export interface AdminRefereeMatch {
  matchId: string;
  name: string;
  mode: MatchMode;
  format: MatchFormat;
  status: MatchStatus;
  startsAt: string;
  matchEndsAt: string;
  goNoGoAt: string;
  venueName: string;
  referee: (MatchReferee & { accountStatus: AccountStatus; activeReferee: boolean }) | null;
  refereeAssignedAt?: string | null;
  history: RefereeAssignmentHistoryEntry[];
}

/** D27: whether a referee is free for a match, and if not, the clashing match. */
export interface AdminRefereeOption {
  userId: string;
  displayName: string;
  isDefault: boolean;
  busy: boolean;
  clash?: { matchId: string; name: string; startsAt: string; matchEndsAt: string } | null;
}

/** D28: the default referee who is assigned automatically when a match is published, if free. */
export interface AdminRefereeSettings {
  defaultReferee: { userId: string; displayName: string } | null;
  updatedAt: string;
  updatedBy?: { id: string; displayName: string } | null;
}
