import type { MatchFormat } from '../config/match-formats.js';
import type { PublicUser } from './user.js';

export const MATCH_STATUSES = [
  'OPEN',
  'READY',
  'IN_PROGRESS',
  'AWAITING_RESULT',
  'COMPLETED',
  'CANCELLED',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export const MATCH_VISIBILITIES = ['PUBLIC', 'PRIVATE'] as const;
export type MatchVisibility = (typeof MATCH_VISIBILITIES)[number];
export const PARTICIPANT_STATUSES = ['JOINED', 'LEFT', 'REMOVED'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];
export const TEAM_SIDES = ['HOME', 'AWAY'] as const;
export type TeamSide = (typeof TEAM_SIDES)[number];

export interface Venue {
  id: string;
  name: string;
  addressLine1: string;
  addressLine2?: string | null;
  locality?: string | null;
  city: string;
  region: string;
  postalCode?: string | null;
  countryCode: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface MatchParticipant {
  id: string;
  matchId: string;
  userId: string;
  status: ParticipantStatus;
  team: TeamSide;
  joinedAt: string;
  leftAt?: string | null;
  user?: PublicUser;
}

export interface FormationSlot {
  id: string;
  matchId: string;
  team: TeamSide;
  slotIndex: number;
  positionX: number;
  positionY: number;
  participantId?: string | null;
  participant?: MatchParticipant | null;
}

export interface MatchScorer {
  id: string;
  participantId: string;
  team: TeamSide;
  goals: number;
  participant?: MatchParticipant;
}
export interface MatchResult {
  id: string;
  homeScore: number;
  awayScore: number;
  submittedAt: string;
  scorers: MatchScorer[];
}

export interface Match {
  id: string;
  name: string;
  description?: string | null;
  createdById: string;
  format: MatchFormat;
  visibility: MatchVisibility;
  startsAt: string;
  durationMinutes: number;
  matchEndsAt: string;
  feeCents: number;
  currency: 'ZAR';
  status: MatchStatus;
  participantCount: number;
  distanceKm?: number;
  homeParticipantCount: number;
  awayParticipantCount: number;
  inviteToken?: string;
  createdAt: string;
  updatedAt: string;
  venue: Venue;
  createdBy?: PublicUser;
  participants?: MatchParticipant[];
  formationSlots?: FormationSlot[];
  result?: MatchResult | null;
}

export interface LobbyMessage {
  id: string;
  matchId: string;
  senderId: string;
  content: string;
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  sender?: PublicUser;
}

export interface CancellationQuote {
  initialCreditCents: number;
  possibleReplacementCreditCents: number;
  hoursUntilKickoff: number;
}

export interface ParticipantCancellationStatus {
  matchId: string;
  originalTeam: TeamSide;
  originalAmountCents: number;
  initialCreditCents: number;
  replacementCreditCents: number;
  replacementFound: boolean;
  cancelledAt: string;
}
