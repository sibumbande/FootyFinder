import type { PublicUser } from './user.js';

export const MATCH_STATUSES = ['OPEN', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export const PARTICIPANT_ROLES = ['HOST', 'PLAYER'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];
export const PARTICIPANT_STATUSES = ['JOINED', 'LEFT', 'REMOVED'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

export interface MatchParticipant { id: string; matchId: string; userId: string; role: ParticipantRole; status: ParticipantStatus; joinedAt: string; user?: PublicUser; }
export interface Match { id: string; name: string; description?: string | null; createdById: string; venueName: string; address?: string | null; latitude?: number | null; longitude?: number | null; startsAt: string; maxPlayers: number; status: MatchStatus; createdAt: string; updatedAt: string; }
export interface LobbyMessage { id: string; matchId: string; senderId: string; content: string; createdAt: string; editedAt?: string | null; deletedAt?: string | null; sender?: PublicUser; }
