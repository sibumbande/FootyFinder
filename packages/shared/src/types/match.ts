import type { MatchFormat } from '../config/match-formats.js';
import type { PublicMatchResult } from './public.js';
import type { PublicUser } from './user.js';
import type { MatchReferee } from './referee.js';
import type { TeamMatchOtherSideMode, TeamMatchOtherSideTakenBy } from '../config/team-match-fees.js';

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
  /** CEO touch-up batch 3, item 1: the FootyFinder venue's page and cover photo. */
  venueSlug?: string;
  coverImage?: { url: string; altText: string };
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
  /** Gate 7 / DEC-019 team fee: R80 x (starterCount + substituteCount). Absent on legacy fixtures. */
  starterCount?: number | null;
  substituteCount?: number | null;
  teamFeeCents?: number | null;
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
/** Gate 8 / TKT-804: one goal of a referee-final result (D7: an own goal names nobody). */
export interface MatchGoalView {
  side: 'HOME' | 'AWAY';
  ownGoal: boolean;
  scorer: { userId: string; displayName: string } | null;
  assist: { userId: string; displayName: string } | null;
}

export interface MatchResult {
  id: string;
  homeScore: number;
  awayScore: number;
  submittedAt: string;
  revisionNumber: number;
  scorers: MatchScorer[];
  /** Gate 8 (DEC-020): PLAYED, FORFEIT or ABANDONED (D13). */
  outcomeType?: 'PLAYED' | 'FORFEIT' | 'ABANDONED';
  forfeitWinner?: 'HOME' | 'AWAY' | null;
  /** LEGACY = self-reported before Gate 8; REFEREE or ADMIN results are final (D5). */
  finalSource?: 'LEGACY' | 'REFEREE' | 'ADMIN';
  finalizedAt?: string | null;
  goals?: MatchGoalView[];
}

export type MatchCancellationReason =
  | 'ORGANISER_CANCELLED'
  | 'POSITIONS_UNFILLED'
  // Gate 7 team matches (DEC-019).
  | 'TEAM_FEES_UNFUNDED'
  | 'NO_OPPONENT'
  | 'TEAM_CANCELLED'
  // Gate 8 (DEC-020, D2): no active FootyFinder referee was assigned by T-30.
  | 'NO_REFEREE'
  // CEO Q4 (2026-09-30): an admin cancelled before kick-off for weather or a venue problem.
  | 'FOOTYFINDER_CANCELLED';

/**
 * DEC-018 go/no-go facts. Present only on matches created under DEC-018: the match goes ahead only
 * if every formation position is claimed by goNoGoAt (kickoff - 30 minutes).
 */
export interface MatchGoNoGoFacts {
  goNoGoAt?: string;
  confirmedAt?: string;
  cancellationReason?: MatchCancellationReason;
}

export interface Match extends MatchGoNoGoFacts {
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
  /** CEO touch-up batch 3, item 5: a free "On FootyFinder" match (R0), optionally for first-time players only. */
  freeOnFootyFinder: boolean;
  firstTimersOnly: boolean;
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
  /** Gate 7 / DEC-019 public team matches only: who may take the other side, and who took it. */
  otherSideMode?: TeamMatchOtherSideMode;
  otherSideTakenBy?: TeamMatchOtherSideTakenBy | null;
  /** Gate 7: the side of this team match the viewer's team plays on, and the side they manage. */
  viewerTeamSide?: TeamSide | null;
  viewerManagedTeamSide?: TeamSide | null;
  /** Gate 8 / D18: the FootyFinder referee assigned to this match (display name only). */
  referee?: MatchReferee | null;
  viewerCanManage: boolean;
  viewerCanChat: boolean;
}

export type PublicMatchJoinabilityReason =
  | 'AVAILABLE'
  | 'FULL'
  | 'CANCELLED'
  | 'STARTED'
  | 'COMPLETED'
  | 'LINEUP_LOCKED'
  | 'UNAVAILABLE'
  // Gate 7 team matches: individuals cannot join these.
  | 'TEAMS_ONLY'
  | 'TAKEN_BY_TEAM';

export interface PublicMatchPreview extends MatchGoNoGoFacts {
  slug: string;
  canonicalUrl: string;
  name: string;
  description?: string;
  venue: {
    name: string;
    city: string;
    region: string;
    /** CEO touch-up batch 3, item 1: the venue's page and cover photo (public facts only). */
    venueSlug?: string;
    coverImage?: { url: string; altText: string };
  };
  startsAt: string;
  durationMinutes: number;
  format: MatchFormat;
  feeCents: number;
  /** CEO touch-up batch 3, item 5: a free "On FootyFinder" match (R0), optionally for first-time players only. */
  freeOnFootyFinder: boolean;
  firstTimersOnly: boolean;
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
  /** Aggregate formation positions claimed (no identities). */
  positions: {
    filled: number;
    total: number;
  };
  /** CEO touch-up batch 2, item 5: starting positions filled on each side (counts only, never who). */
  sides: Record<'home' | 'away', { filled: number; total: number }>;
  /** Gate 7 / DEC-019 team match labels (team names only; no people, no money beyond the rules). */
  teamMatch?: {
    homeTeamName: string;
    awayTeamName?: string;
    otherSideMode: TeamMatchOtherSideMode;
    otherSideTakenBy: TeamMatchOtherSideTakenBy | null;
  };
  /** Gate 9 / TKT-910: the final result with scorers, once a referee (or FootyFinder) has recorded it. */
  result?: PublicMatchResult;
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
