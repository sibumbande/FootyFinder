import type { Match, MatchParticipant } from '@footy-finder/shared';
import { toPublicUser } from '../users/user.mapper.js';

type ParticipantSource = {
  id: string; matchId: string; userId: string; role: 'HOST' | 'PLAYER'; status: 'JOINED' | 'LEFT' | 'REMOVED';
  team: 'HOME' | 'AWAY' | null; squadRole: 'STARTER' | 'RESERVE' | null; slotNumber: number | null; joinedAt: Date;
  user?: Parameters<typeof toPublicUser>[0];
};

type MatchSource = {
  id: string; name: string; description: string | null; createdById: string; venueName: string; address: string | null;
  latitude: number | null; longitude: number | null; startsAt: Date; maxPlayers: number;
  status: 'OPEN' | 'FULL' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'; createdAt: Date; updatedAt: Date;
  createdBy?: Parameters<typeof toPublicUser>[0]; participants?: ParticipantSource[];
};

export function toMatchParticipant(participant: ParticipantSource): MatchParticipant {
  return {
    id: participant.id, matchId: participant.matchId, userId: participant.userId, role: participant.role,
    status: participant.status, team: participant.team, squadRole: participant.squadRole,
    slotNumber: participant.slotNumber, joinedAt: participant.joinedAt.toISOString(),
    user: participant.user ? toPublicUser(participant.user) : undefined,
  };
}

export function toMatch(match: MatchSource): Match {
  return {
    id: match.id, name: match.name, description: match.description, createdById: match.createdById,
    venueName: match.venueName, address: match.address, latitude: match.latitude, longitude: match.longitude,
    startsAt: match.startsAt.toISOString(), maxPlayers: match.maxPlayers, status: match.status,
    participantCount: match.participants?.length ?? 0, createdAt: match.createdAt.toISOString(),
    updatedAt: match.updatedAt.toISOString(), createdBy: match.createdBy ? toPublicUser(match.createdBy) : undefined,
    participants: match.participants?.map(toMatchParticipant),
  };
}
