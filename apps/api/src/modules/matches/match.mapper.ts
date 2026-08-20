import type { FormationSlot, Match, MatchParticipant, MatchStatus } from '@footy-finder/shared';
import { getEffectiveMatchStatus, getMatchEndsAt } from '@footy-finder/shared';
import { toPublicUser } from '../users/user.mapper.js';
import type { MatchRecord, ParticipantRecord } from './match.query.js';

export function toMatchParticipant(participant: ParticipantRecord): MatchParticipant {
  return {
    id: participant.id,
    matchId: participant.matchId,
    userId: participant.userId,
    status: participant.status,
    team: participant.team,
    joinedAt: participant.joinedAt.toISOString(),
    leftAt: participant.leftAt?.toISOString(),
    user: toPublicUser(participant.user),
  };
}

const toFormationSlot = (slot: MatchRecord['formationSlots'][number]): FormationSlot => ({
  id: slot.id,
  matchId: slot.matchId,
  team: slot.team,
  slotIndex: slot.slotIndex,
  positionX: Number(slot.positionX),
  positionY: Number(slot.positionY),
  participantId: slot.participantId,
  participant: slot.participant ? toMatchParticipant(slot.participant) : null,
});

export function toMatch(match: MatchRecord, options: { includeInvite?: boolean } = {}): Match {
  const storedStatus = (match.status === 'FULL' ? 'OPEN' : match.status) as MatchStatus;
  const status = getEffectiveMatchStatus({
    status: storedStatus,
    startsAt: match.startsAt,
    durationMinutes: match.durationMinutes,
  });
  return {
    id: match.id,
    name: match.name,
    description: match.description,
    createdById: match.createdById,
    format: match.format,
    visibility: match.visibility,
    startsAt: match.startsAt.toISOString(),
    durationMinutes: match.durationMinutes,
    matchEndsAt: getMatchEndsAt({
      startsAt: match.startsAt,
      durationMinutes: match.durationMinutes,
    }).toISOString(),
    feeCents: match.feeCents,
    currency: 'ZAR',
    status,
    participantCount: match.participants.length,
    homeParticipantCount: match.participants.filter(({ team }) => team === 'HOME').length,
    awayParticipantCount: match.participants.filter(({ team }) => team === 'AWAY').length,
    inviteToken: options.includeInvite ? (match.inviteToken ?? undefined) : undefined,
    createdAt: match.createdAt.toISOString(),
    updatedAt: match.updatedAt.toISOString(),
    venue: {
      ...match.venue,
      latitude: match.venue.latitude === null ? null : Number(match.venue.latitude),
      longitude: match.venue.longitude === null ? null : Number(match.venue.longitude),
    },
    createdBy: toPublicUser(match.createdBy),
    participants: match.participants.map(toMatchParticipant),
    formationSlots: match.formationSlots.map(toFormationSlot),
    result: match.result
      ? {
          id: match.result.id,
          homeScore: match.result.homeScore,
          awayScore: match.result.awayScore,
          submittedAt: match.result.submittedAt.toISOString(),
          scorers: match.result.scorers.map((scorer) => ({
            id: scorer.id,
            participantId: scorer.participantId,
            team: scorer.team,
            goals: scorer.goals,
            participant: toMatchParticipant(scorer.participant),
          })),
        }
      : null,
  };
}
