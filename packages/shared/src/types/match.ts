import type { MatchFormat } from '../config/match-formats.js';
import type { PublicUser } from './user.js';

export const MATCH_STATUSES = [
  'DRAFT',
  'OPEN',
  'READY',
  'FULL',
  'IN_PROGRESS',
  'AWAITING_RESULT',
  'COMPLETED',
  'CANCELLED',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export const MATCH_MODES = ['QUICK_GAME', 'TEAM_MATCH'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];
export const MATCH_VISIBILITIES = ['PUBLIC', 'PRIVATE'] as const;
export type MatchVisibility = (typeof MATCH_VISIBILITIES)[number];
export const PARTICIPANT_STATUSES = ['JOINED', 'LEFT', 'REMOVED'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];
export const TEAM_SIDES = ['HOME', 'AWAY'] as const;
export type TeamSide = (typeof TEAM_SIDES)[number];
export const TEAM_MATCH_AVAILABILITY_STATUSES = [
  'AVAILABLE',
  'MAYBE',
  'UNAVAILABLE',
  'NO_RESPONSE',
] as const;
export type TeamMatchAvailabilityStatus = (typeof TEAM_MATCH_AVAILABILITY_STATUSES)[number];
export const TEAM_MATCH_SELECTION_STATUSES = [
  'INVITED',
  'SELECTED_STARTER',
  'SELECTED_SUBSTITUTE',
  'OPEN_SLOT_CLAIMED',
  'DECLINED',
  'REMOVED',
] as const;
export type TeamMatchSelectionStatus = (typeof TEAM_MATCH_SELECTION_STATUSES)[number];
export const DISPLACED_PLAYER_ACTIONS = ['SWAP', 'BENCH', 'REMOVE'] as const;
export type DisplacedPlayerAction = (typeof DISPLACED_PLAYER_ACTIONS)[number];
export const LINEUP_PLAYER_ACTIONS = ['BENCH', 'REMOVE'] as const;
export type LineupPlayerAction = (typeof LINEUP_PLAYER_ACTIONS)[number];
export const MATCH_RULES = ['GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'] as const;
export type MatchRule = (typeof MATCH_RULES)[number];

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

/** Authoritative formation snapshot returned by a committed claim or sent with a claim conflict. */
export interface FormationSnapshot {
  matchId: string;
  formationVersion: number;
  slots: FormationSlot[];
}

export interface MatchScorer {
  id: string;
  participantId: string;
  team: TeamSide;
  goals: number;
  participant?: MatchParticipant;
}

export interface MatchTeamSide {
  id: string;
  matchId: string;
  teamId?: string | null;
  side: TeamSide;
  organisingUserId: string;
  formationKey: string;
  teamNameSnapshot: string;
  teamImageUrlSnapshot?: string | null;
  primaryColorSnapshot?: string | null;
  secondaryColorSnapshot?: string | null;
  availabilityRequestedAt?: string | null;
  lineupFinalizedAt?: string | null;
}

export interface TeamMatchAvailabilityRow {
  id: string;
  matchTeamId: string;
  userId: string;
  status: TeamMatchAvailabilityStatus;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
  user: PublicUser;
  selectionStatus: TeamMatchSelectionStatus | null;
}

export interface TeamMatchAvailabilitySummary {
  squadPool: number;
  available: number;
  maybe: number;
  unavailable: number;
  noResponse: number;
}

export interface TeamMatchAvailabilityResponse {
  requestedAt: string | null;
  summary: TeamMatchAvailabilitySummary;
  rows: TeamMatchAvailabilityRow[];
}

export interface TeamMatchAvailabilityRequestResult {
  requestedAt: string;
  addedMemberCount: number;
  notifiedMemberCount: number;
}

export interface TeamMatchAvailabilityChangedEvent {
  matchId: string;
  side: TeamSide;
}

export interface TeamMatchAvailabilityRequestedEvent extends TeamMatchAvailabilityChangedEvent {
  requestedAt: string;
}

export type TeamMatchLineupChangeReason =
  'SELECTION' | 'POSITION_OPENED' | 'POSITION_CLAIMED' | 'MOVEMENT' | 'FINALIZED' | 'DEFAULT_SAVED';

export interface TeamMatchLineupChangedEvent {
  matchId: string;
  side: TeamSide;
  reason: TeamMatchLineupChangeReason;
}

export interface TeamMatchSelection {
  id: string;
  matchTeamId: string;
  userId: string;
  status: TeamMatchSelectionStatus;
  selectedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  user: PublicUser;
}

export interface TeamMatchLineupSlot {
  id: string;
  matchTeamId: string;
  slotIndex: number;
  positionX: number;
  positionY: number;
  isOpen: boolean;
  selection: TeamMatchSelection | null;
}

export interface TeamMatchLineup {
  matchId: string;
  matchTeamId: string;
  teamId: string;
  side: TeamSide;
  format: MatchFormat;
  formationKey: string;
  starterCapacity: number;
  substituteCapacity: number;
  lineupFinalizedAt: string | null;
  viewerCanManage: boolean;
  slots: TeamMatchLineupSlot[];
  substitutes: TeamMatchSelection[];
  viewerSelection: TeamMatchSelection | null;
  selectionPool?: TeamMatchSelection[];
}
export interface MatchResult {
  id: string;
  homeScore: number;
  awayScore: number;
  submittedAt: string;
  revisionNumber: number;
  scorers: MatchScorer[];
}

export interface Match {
  id: string;
  publicSlug?: string;
  canonicalUrl?: string;
  name: string;
  description?: string | null;
  createdById: string;
  mode: MatchMode;
  format: MatchFormat;
  substituteCapacityPerTeam: number;
  rollingSubstitutes: boolean;
  rules: MatchRule[];
  visibility: MatchVisibility;
  startsAt: string;
  durationMinutes: number;
  matchEndsAt: string;
  feeCents: number;
  currency: 'ZAR';
  status: MatchStatus;
  participantCount: number;
  homeParticipantCount: number;
  awayParticipantCount: number;
  inviteToken?: string;
  createdAt: string;
  updatedAt: string;
  venue: Venue;
  createdBy?: PublicUser;
  participants?: MatchParticipant[];
  formationSlots?: FormationSlot[];
  formationVersion: number;
  result?: MatchResult | null;
  teamSides: MatchTeamSide[];
  viewerCanManage: boolean;
  viewerCanChat: boolean;
}

export type PublicMatchJoinabilityReason =
  | 'AVAILABLE'
  | 'FULL'
  | 'CANCELLED'
  | 'STARTED'
  | 'COMPLETED'
  | 'UNAVAILABLE';

export interface PublicMatchPreview {
  slug: string;
  canonicalUrl: string;
  name: string;
  description?: string;
  venue: {
    name: string;
    city: string;
    region: string;
  };
  startsAt: string;
  durationMinutes: number;
  format: MatchFormat;
  feeCents: number;
  currency: 'ZAR';
  rules: Array<{ code: MatchRule; label: string }>;
  status: MatchStatus;
  joinability: {
    canJoin: boolean;
    reason: PublicMatchJoinabilityReason;
  };
  capacity: {
    filled: number;
    total: number;
  };
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
