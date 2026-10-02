import type { PublicUser } from './user.js';

export type ModerationReportTargetType =
  | 'USER'
  | 'DIRECT_MESSAGE'
  | 'LOBBY_MESSAGE'
  | 'TEAM'
  | 'MATCH'
  | 'RECRUITMENT_POST'
  | 'LOOKING_CARD';
export type ModerationReportReason =
  | 'HARASSMENT'
  | 'ABUSE'
  | 'CHEATING'
  | 'SPAM'
  | 'IMPERSONATION'
  | 'SAFETY'
  | 'OTHER';
export type ModerationReportStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'DISMISSED';
export type AccountEnforcementType = 'SUSPENSION' | 'BAN';
export type AccountEnforcementStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface ModerationReport {
  id: string;
  targetType: ModerationReportTargetType;
  targetId: string;
  reason: ModerationReportReason;
  details?: string;
  evidenceSnapshot?: Record<string, unknown>;
  status: ModerationReportStatus;
  resolutionSummary?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  reporter?: PublicUser;
  assignedAdmin?: PublicUser;
}

export interface AccountEnforcement {
  id: string;
  userId: string;
  type: AccountEnforcementType;
  status: AccountEnforcementStatus;
  publicReason: string;
  internalNote?: string;
  startsAt: string;
  endsAt?: string;
  revokedAt?: string;
  createdAt: string;
  createdByAdmin?: PublicUser;
  revokedByAdmin?: PublicUser;
}

export interface ModerationUserSummary {
  user: PublicUser & {
    email: string;
    accountStatus: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
    platformRole: 'USER' | 'ADMIN';
    /** CEO touch-up batch 4, item 1: admin-only (user detail), never in public data. */
    gender?: 'MALE' | 'FEMALE' | null;
  };
  activeEnforcement?: AccountEnforcement;
  enforcementHistory: AccountEnforcement[];
  reportCount: number;
}
