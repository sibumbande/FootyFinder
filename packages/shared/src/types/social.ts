import type { FootballPosition } from './user.js';

/** Gate 9 / TKT-901: section 3A Friendship rule and the CEO's Gate 9 limits. */
export const FRIEND_REQUEST_EXPIRY_DAYS = 30;
export const FRIEND_REQUESTS_PER_DAY = 20;
export const FRIEND_REQUESTS_PENDING_MAX = 100;
export const FRIEND_REQUEST_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED'] as const;
export type FriendRequestStatus = (typeof FRIEND_REQUEST_STATUSES)[number];

/**
 * What the "Add friend" button shows for another player.
 * - SELF / UNAVAILABLE: no button (yourself, blocked either way, incoming requests turned off,
 *   or an account that cannot be befriended).
 * - CAN_REQUEST: "Add friend"; REQUESTED: "Requested"; INCOMING: "Accept"; FRIENDS: "Friends".
 */
export const RELATIONSHIP_STATES = ['SELF', 'CAN_REQUEST', 'REQUESTED', 'INCOMING', 'FRIENDS', 'UNAVAILABLE'] as const;
export type RelationshipState = (typeof RELATIONSHIP_STATES)[number];
export interface Relationship {
  userId: string;
  state: RelationshipState;
  /** The pending request, for REQUESTED (cancel) and INCOMING (accept/decline). */
  requestId?: string;
  /** Gate 9 / TKT-903: true only when the viewer blocked this player (shows "Unblock"). Never says who blocked the viewer. */
  blockedByYou?: boolean;
}

/** Minimal card for search, friends and played-with lists: no contact, age or billing data. */
export interface SocialPlayerCard {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  city?: string | null;
  homeArea?: string | null;
  preferredPositions: FootballPosition[];
  relationship: Relationship;
}

export interface FriendRequestView {
  id: string;
  status: FriendRequestStatus;
  createdAt: string;
  expiresAt: string;
  player: SocialPlayerCard;
}

export interface FriendRequestsView {
  incoming: FriendRequestView[];
  outgoing: FriendRequestView[];
}

export interface SocialSummary {
  friends: number;
  incomingRequests: number;
  unreadConversations: number;
}

export interface SocialSettings {
  friendRequestsEnabled: boolean;
}

export interface SendFriendRequestResult {
  relationship: Relationship;
}

/** CEO Gate 9: "Players you played with" on a finished match (the Lineup Record, both sides). */
export interface PlayedWithView {
  matchId: string;
  players: Array<SocialPlayerCard & { side: 'HOME' | 'AWAY'; teammate: boolean }>;
}

export interface AddAllResult {
  sent: number;
  skipped: number;
  /** Set when the 100 pending-outgoing cap stopped the batch early. */
  limitReached: boolean;
}


/** Gate 9 / TKT-904 (D11): a personal invite to join a Team, from its Owner or a Captain. */
export const TEAM_MEMBER_INVITE_EXPIRY_DAYS = 14;
export const TEAM_MEMBER_INVITE_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED'] as const;
export type TeamMemberInviteStatus = (typeof TEAM_MEMBER_INVITE_STATUSES)[number];
export const TEAM_MEMBER_INVITE_SOURCES = ['FRIEND', 'LOOKING'] as const;
export type TeamMemberInviteSource = (typeof TEAM_MEMBER_INVITE_SOURCES)[number];
export interface TeamMemberInviteView {
  id: string;
  status: TeamMemberInviteStatus;
  source: TeamMemberInviteSource;
  createdAt: string;
  expiresAt: string;
  team: { id: string; name: string; profileImageUrl?: string | null };
  invitedBy: { id: string; displayName: string; username: string };
  invitee: SocialPlayerCard;
}
/** A friend in the team-invite picker: already a member, already invited, or invitable. */
export interface InvitableFriend {
  player: SocialPlayerCard;
  status: 'MEMBER' | 'INVITED' | 'INVITABLE';
  inviteId?: string;
}
