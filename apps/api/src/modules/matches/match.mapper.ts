import type {
  FormationSlot,
  Match,
  MatchCancellationReason,
  MatchParticipant,
  MatchStatus,
} from '@footy-finder/shared';
import { getEffectiveMatchStatus, getMatchEndsAt, isMatchAtCapacity } from '@footy-finder/shared';
import { toPublicUser } from '../users/user.mapper.js';
import type { MatchRecord, ParticipantRecord } from './match.query.js';
import { publicMatchUrl } from './public-match.js';

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

export const toFormationSlot = (slot: MatchRecord['formationSlots'][number]): FormationSlot => ({
  id: slot.id,
  matchId: slot.matchId,
  team: slot.team,
  slotIndex: slot.slotIndex,
  positionX: Number(slot.positionX),
  positionY: Number(slot.positionY),
  participantId: slot.participantId,
  participant: slot.participant ? toMatchParticipant(slot.participant) : null,
});

/** DEC-018 go/no-go facts, only for matches created under the rule (legacy matches omit them). */
export const goNoGoFacts = (match: {
  goNoGoAt: Date | null;
  confirmedAt: Date | null;
  cancellationReason: string | null;
}) =>
  match.goNoGoAt
    ? {
        goNoGoAt: match.goNoGoAt.toISOString(),
        ...(match.confirmedAt ? { confirmedAt: match.confirmedAt.toISOString() } : {}),
        ...(match.cancellationReason
          ? { cancellationReason: match.cancellationReason as MatchCancellationReason }
          : {}),
      }
    : {};

export function toMatch(
  match: MatchRecord,
  options: {
    inviteToken?: string;
    viewerCanManage?: boolean;
    viewerCanChat?: boolean;
  } = {},
): Match {
  const lifecycleStatus = getEffectiveMatchStatus({
    status: match.status as MatchStatus,
    startsAt: match.startsAt,
    durationMinutes: match.durationMinutes,
  });
  const status =
    ['OPEN', 'READY'].includes(lifecycleStatus) &&
    isMatchAtCapacity(
      match.format,
      match.substituteCapacityPerTeam,
      match.participants.length,
    )
      ? ('FULL' as const)
      : lifecycleStatus;
  return {
    id: match.id,
    ...(match.publicSlug
      ? { publicSlug: match.publicSlug, canonicalUrl: publicMatchUrl(match.publicSlug) }
      : {}),
    name: match.name,
    description: match.description,
    createdById: match.createdById,
    mode: match.mode,
    format: match.format,
    substituteCapacityPerTeam: match.substituteCapacityPerTeam,
    rollingSubstitutes: match.rollingSubstitutes,
    rules: match.rules,
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
    inviteToken: options.inviteToken,
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
    formationVersion: match.formationVersion,
    result: match.result
      ? {
          id: match.result.id,
          homeScore: match.result.homeScore,
          awayScore: match.result.awayScore,
          submittedAt: match.result.submittedAt.toISOString(),
          revisionNumber: match.result.revisions[0]?.revisionNumber ?? 1,
          scorers: match.result.scorers.map((scorer) => ({
            id: scorer.id,
            participantId: scorer.participantId,
            team: scorer.team,
            goals: scorer.goals,
            participant: toMatchParticipant(scorer.participant),
          })),
        }
      : null,
    teamSides: match.teamSides.map((teamSide) => ({
      id: teamSide.id,
      matchId: teamSide.matchId,
      teamId: teamSide.teamId,
      side: teamSide.side,
      organisingUserId: teamSide.organisingUserId,
      formationKey: teamSide.formationKey,
      teamNameSnapshot: teamSide.teamNameSnapshot,
      teamImageUrlSnapshot: teamSide.teamImageUrlSnapshot,
      primaryColorSnapshot: teamSide.primaryColorSnapshot,
      secondaryColorSnapshot: teamSide.secondaryColorSnapshot,
      availabilityRequestedAt: teamSide.availabilityRequestedAt?.toISOString(),
      lineupFinalizedAt: teamSide.lineupFinalizedAt?.toISOString(),
      ...(teamSide.teamFeeCents !== null && {
        starterCount: teamSide.starterCount,
        substituteCount: teamSide.substituteCount,
        teamFeeCents: teamSide.teamFeeCents,
      }),
    })),
    ...(match.otherSideMode && {
      otherSideMode: match.otherSideMode,
      otherSideTakenBy: match.otherSideTakenBy,
    }),
    ...goNoGoFacts(match),
    viewerCanManage: options.viewerCanManage ?? false,
    viewerCanChat: options.viewerCanChat ?? false,
  };
}
