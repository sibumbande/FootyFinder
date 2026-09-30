import type { MatchFormat } from '../config/match-formats.js';
import type { SocialPlayerCard } from './social.js';
import type { FootballPosition } from './user.js';

/** Gate 9 / TKT-909: the team recruitment board (Teams tab in Social). No money is involved. */
export const RECRUITMENT_LEVELS = ['CASUAL', 'COMPETITIVE'] as const;
export type RecruitmentLevel = (typeof RECRUITMENT_LEVELS)[number];
export const TIMES_OF_DAY = ['MORNING', 'AFTERNOON', 'EVENING'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];
/** 0 = Sunday ... 6 = Saturday, as in Date.getDay(). */
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const RECRUITMENT_POST_DAYS = 30;
export const JOIN_REQUEST_EXPIRY_DAYS = 14;
export const JOIN_REQUESTS_PENDING_MAX = 10;
export const RECRUITMENT_NOTE_MAX = 300;
export type RecruitmentPostStatus = 'OPEN' | 'CLOSED' | 'REMOVED';
export type TeamJoinRequestStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';

export interface Availability {
  days: number[];
  times: TimeOfDay[];
}

export interface RecruitmentPostView extends Availability {
  id: string;
  team: { id: string; name: string; profileImageUrl?: string | null };
  positions: FootballPosition[];
  playersWanted: number;
  /** Players who joined through this post (accepted "Ask to join"). */
  joinedCount: number;
  format: MatchFormat;
  level: RecruitmentLevel;
  area: string;
  note?: string | null;
  status: RecruitmentPostStatus;
  expiresAt: string;
  createdAt: string;
  expired: boolean;
  /** The viewer is the team's Owner or a Captain. */
  viewerCanManage: boolean;
  /** The viewer is already a member of this team. */
  viewerIsMember: boolean;
  viewerRequest?: { id: string; status: TeamJoinRequestStatus } | null;
}

export interface LookingCardView extends Availability {
  id: string;
  player: SocialPlayerCard;
  positions: FootballPosition[];
  area?: string | null;
  note?: string | null;
  updatedAt: string;
}

export interface MyLookingCard extends Availability {
  enabled: boolean;
  positions: FootballPosition[];
  area?: string | null;
  note?: string | null;
  removedByFootyFinder: boolean;
}

export interface TeamJoinRequestView {
  id: string;
  status: TeamJoinRequestStatus;
  createdAt: string;
  expiresAt: string;
  team: { id: string; name: string };
  postId?: string | null;
  player: SocialPlayerCard;
}

export interface AdminRecruitmentItem {
  kind: 'POST' | 'CARD';
  id: string;
  title: string;
  ownerDisplayName: string;
  teamId?: string | null;
  userId?: string | null;
  note?: string | null;
  area?: string | null;
  status: string;
  openReports: number;
  removedAt?: string | null;
  removedReason?: string | null;
  createdAt: string;
}
