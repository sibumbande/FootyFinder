import type { MatchFormat } from '../config/match-formats.js';
import type { PublicUser } from './user.js';

export const TEAM_ROLES = ['OWNER', 'CAPTAIN', 'MEMBER'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export interface TeamSummary {
  id: string;
  name: string;
  shortName?: string | null;
  profileImageUrl?: string | null;
  locationText?: string | null;
  primaryFormat: MatchFormat;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  memberCount: number;
  viewerRole?: TeamRole | null;
  /** Gate 7 / D7: set when the team was closed (archived, read-only). */
  archivedAt?: string | null;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: TeamRole;
  joinedAt: string;
  user: PublicUser;
}

export interface TeamDetail extends TeamSummary {
  description?: string | null;
  /** CEO touch-up batch 4, item 2. */
  stats?: TeamStats;
  ownerUserId: string;
  owner: PublicUser;
  members: TeamMember[];
  createdAt: string;
  updatedAt: string;
}

export type TeamInviteStatus = 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED';

export interface TeamInviteMetadata {
  id: string;
  teamId: string;
  createdBy: PublicUser;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  maxUses: number;
  useCount: number;
  status: TeamInviteStatus;
  inviteUrl?: string;
}

export interface TeamInviteLanding {
  team: TeamSummary & { description?: string | null };
  invitedBy: PublicUser;
  expiresAt: string;
  status: TeamInviteStatus;
}

export interface TeamFormationMember {
  id: string;
  userId: string;
  user: PublicUser;
}

export interface TeamFormationSlot {
  id: string;
  formationId: string;
  slotIndex: number;
  positionX: number;
  positionY: number;
  membershipId?: string | null;
  member?: TeamFormationMember | null;
}

export interface TeamFormation {
  id: string;
  teamId: string;
  format: MatchFormat;
  formationKey: string;
  slots: TeamFormationSlot[];
  updatedAt: string;
}

/** CEO touch-up batch 4, item 2: a team's results from final results only (the same rules as player statistics). */
export interface TeamFormEntry {
  matchId: string;
  startsAt: string;
  outcome: 'W' | 'D' | 'L';
  opponent: string;
  goalsFor: number;
  goalsAgainst: number;
  forfeit: boolean;
}
export interface TeamStats {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  /** The last five results, newest first. */
  lastFive: TeamFormEntry[];
}
