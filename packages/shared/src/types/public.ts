import type { MatchFormat } from '../config/match-formats.js';
import type { PlayerStatistics, FootballPosition } from './user.js';

/**
 * Gate 9 / TKT-910: what anyone on the internet can see without an account. These shapes never
 * carry email addresses, dates of birth, chats, messages, friends lists, wallet or payment data,
 * or any venue cost, payable or settlement data. Before a match is played, no names are shown.
 */
export interface PublicMatchResult {
  homeName: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  outcome: 'PLAYED' | 'FORFEIT' | 'ABANDONED';
  forfeitWinner?: 'HOME' | 'AWAY' | null;
  goals: Array<{ side: 'HOME' | 'AWAY'; scorer?: string | null; assister?: string | null; ownGoal: boolean }>;
}

export interface PublicTeamMember {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl?: string | null;
  role: 'OWNER' | 'CAPTAIN' | 'MEMBER';
  positions: FootballPosition[];
}

export interface PublicTeamView {
  id: string;
  name: string;
  shortName?: string | null;
  profileImageUrl?: string | null;
  primaryFormat: MatchFormat;
  locationText?: string | null;
  description?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  closed: boolean;
  members: PublicTeamMember[];
  record: { played: number; wins: number; draws: number; losses: number };
  reviews: { enoughReviews: boolean; averageRating: number | null; reviewCount: number | null };
}

export interface GuestPlayerProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string | null;
  preferredPositions: FootballPosition[];
  city?: string | null;
  teams: Array<{ id: string; name: string; shortName?: string | null; profileImageUrl?: string | null; role: 'OWNER' | 'CAPTAIN' | 'MEMBER' }>;
  statistics: PlayerStatistics;
}
