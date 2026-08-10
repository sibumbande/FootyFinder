import type { PublicUser } from './user.js';

export const MATCH_STATUSES = ['OPEN', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export const PARTICIPANT_ROLES = ['HOST', 'PLAYER'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];
export const PARTICIPANT_STATUSES = ['JOINED', 'LEFT', 'REMOVED'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];
export const TEAM_SIDES = ['HOME', 'AWAY'] as const;
export type TeamSide = (typeof TEAM_SIDES)[number];
export const SQUAD_ROLES = ['STARTER', 'RESERVE'] as const;
export type SquadRole = (typeof SQUAD_ROLES)[number];

export const MATCH_CAPACITY = 30;
export const STARTERS_PER_TEAM = 10;
export const RESERVES_PER_TEAM = 5;

export interface MatchParticipant {
  id: string;
  matchId: string;
  userId: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  team?: TeamSide | null;
  squadRole?: SquadRole | null;
  slotNumber?: number | null;
  joinedAt: string;
  user?: PublicUser;
}

export interface Match {
  id: string;
  name: string;
  description?: string | null;
  createdById: string;
  venueName: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  startsAt: string;
  maxPlayers: number;
  status: MatchStatus;
  participantCount: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: PublicUser;
  participants?: MatchParticipant[];
}

export interface LobbyMessage { id: string; matchId: string; senderId: string; content: string; createdAt: string; editedAt?: string | null; deletedAt?: string | null; sender?: PublicUser; }
