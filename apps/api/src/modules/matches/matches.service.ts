import { randomBytes } from 'node:crypto';
import type {
  ChangeParticipantTeamInput,
  CreateMatchInput,
  DiscoveryQuery,
  FormationSlotUpdateInput,
  JoinMatchInput,
  ResultInput,
  UpdateMatchInput,
} from '@footy-finder/shared';
import {
  CANCELLATION_CUTOFF_HOURS,
  canChangeLobby,
  getCancellationCreditCents,
  getEffectiveMatchStatus,
  getMaxMatchParticipants,
  getMaxParticipantsPerTeam,
} from '@footy-finder/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { domainEvents } from '../../events/domain-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { toMatch, toMatchParticipant } from './match.mapper.js';
import {
  AlreadyJoinedError,
  InsufficientBalanceError,
  MatchClosedError,
  MatchesRepository,
  TeamFullError,
  TeamMatchPlanningError,
} from './matches.repository.js';

const durations = {
  FIVE_A_SIDE: env.MATCH_DURATION_FIVE_A_SIDE_MINUTES,
  SEVEN_A_SIDE: env.MATCH_DURATION_SEVEN_A_SIDE_MINUTES,
  ELEVEN_A_SIDE: env.MATCH_DURATION_ELEVEN_A_SIDE_MINUTES,
} as const;
const distanceKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export class MatchesService {
  constructor(
    private readonly matches = new MatchesRepository(),
    private readonly notifications = new NotificationsService(),
  ) {}

  async list(query: DiscoveryQuery) {
    let matches = (await this.matches.listPublic(query)).map((match) => ({
      match: toMatch(match),
      distance:
        query.lat !== undefined && match.venue.latitude !== null
          ? distanceKm(
              query.lat,
              query.lng!,
              Number(match.venue.latitude),
              Number(match.venue.longitude),
            )
          : undefined,
    }));
    if (query.lat !== undefined)
      matches = matches.filter(
        ({ distance }) => distance !== undefined && distance <= query.radiusKm,
      );
    if (query.availableOnly)
      matches = matches.filter(
        ({ match }) =>
          match.participantCount <
          getMaxMatchParticipants(match.format, match.substituteCapacityPerTeam),
      );
    if ((query.sort ?? (query.lat === undefined ? 'soonest' : 'nearest')) === 'nearest')
      matches.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    return matches.map(({ match, distance }) => ({ ...match, distanceKm: distance }));
  }
  async get(id: string, userId: string) {
    const match = await this.load(id);
    const attachedMembership =
      match.mode === 'TEAM_MATCH'
        ? await this.matches.findAttachedTeamMembership(id, userId)
        : null;
    const isParticipant = match.participants.some((item) => item.userId === userId);
    if (
      match.visibility === 'PRIVATE' &&
      match.createdById !== userId &&
      !isParticipant &&
      !attachedMembership &&
      !(await this.matches.hasParticipation(id, userId))
    )
      throw new AppError(
        403,
        'Use a valid invitation to access this private match.',
        'PRIVATE_MATCH',
      );
    const viewerCanManage =
      match.mode === 'QUICK_GAME'
        ? match.createdById === userId
        : attachedMembership?.role === 'OWNER' || attachedMembership?.role === 'CAPTAIN';
    return toMatch(match, {
      includeInvite: match.mode === 'QUICK_GAME' && match.createdById === userId,
      viewerCanManage,
      viewerCanChat: match.createdById === userId || isParticipant || Boolean(attachedMembership),
    });
  }
  async getByInvite(token: string) {
    const match = await this.matches.findByInviteToken(token);
    if (!match)
      throw new AppError(404, 'Match invitation is invalid or expired.', 'INVITE_NOT_FOUND');
    return toMatch(match);
  }
  async create(input: CreateMatchInput, userId: string) {
    const inviteToken =
      input.visibility === 'PRIVATE' ? randomBytes(32).toString('base64url') : undefined;
    return toMatch(await this.matches.create(input, userId, durations[input.format], inviteToken), {
      includeInvite: true,
      viewerCanManage: true,
      viewerCanChat: true,
    });
  }
  async update(id: string, input: UpdateMatchInput, userId: string) {
    const match = await this.assertManager(id, userId);
    this.assertMutable(match);
    return toMatch(await this.matches.update(id, input), {
      includeInvite: match.mode === 'QUICK_GAME',
      viewerCanManage: true,
      viewerCanChat: true,
    });
  }
  async ready(id: string, userId: string) {
    const match = await this.assertManager(id, userId);
    if (match.mode === 'TEAM_MATCH')
      throw new AppError(
        409,
        'Team fixtures remain planning drafts until booking and funding are available.',
        'TEAM_MATCH_DRAFT',
      );
    this.assertMutable(match);
    return toMatch(await this.matches.markReady(id), {
      includeInvite: true,
      viewerCanManage: true,
      viewerCanChat: true,
    });
  }

  async remove(id: string, userId: string) {
    const match = await this.assertManager(id, userId);
    if (match.status === 'CANCELLED') return;
    this.assertMutable(match);
    const { refundedUserIds } = await this.matches.cancelMatch(id);
    await Promise.all(
      refundedUserIds.map((refundedUserId) =>
        this.notifications.create(
          refundedUserId,
          'MATCH_CANCELLED',
          'Match cancelled',
          'Your full match fee was credited to your Footy Finder wallet.',
          `/matches/${id}`,
        ),
      ),
    );
  }

  async join(id: string, userId: string, input: JoinMatchInput, idempotencyKey: string) {
    if (!idempotencyKey || idempotencyKey.length > 200)
      throw new AppError(
        400,
        'A valid Idempotency-Key header is required.',
        'IDEMPOTENCY_KEY_REQUIRED',
      );
    try {
      const result = await this.matches.join(id, userId, input, idempotencyKey);
      if (!result.replayed) {
        const participant = toMatchParticipant(result.participant);
        domainEvents.emit('participant:joined', {
          matchId: id,
          participant,
        });
        await this.notifications.create(
          userId,
          'MATCH_JOINED',
          'Match joined',
          `Your place on the ${input.team === 'HOME' ? 'Home' : 'Away'} team is confirmed.`,
          `/matches/${id}`,
        );
        const joinedMatch = await this.load(id);
        const audience = new Set([
          joinedMatch.createdById,
          ...joinedMatch.participants.map(({ userId: participantUserId }) => participantUserId),
        ]);
        audience.delete(userId);
        await Promise.all(
          [...audience].map((recipientId) =>
            this.notifications.create(
              recipientId,
              'INFO',
              'Player joined',
              `${participant.user?.displayName ?? 'A player'} joined the ${input.team === 'HOME' ? 'Home' : 'Away'} team.`,
              `/matches/${id}`,
            ),
          ),
        );
        if (result.replacement)
          await Promise.all([
            this.notifications.create(
              result.replacement.userId,
              'REPLACEMENT_FOUND',
              'Replacement found',
              'The remaining cancellation credit was added to your wallet.',
              `/matches/${id}`,
            ),
            this.notifications.create(
              result.replacement.userId,
              'WALLET_CREDIT',
              'Wallet credited',
              `R${(result.replacement.amountCents / 100).toFixed(2)} was added to your balance.`,
              `/matches/${id}`,
            ),
          ]);
      }
      return toMatchParticipant(result.participant);
    } catch (error) {
      this.rethrowJoinError(error);
    }
  }

  async cancellationQuote(id: string, userId: string) {
    const match = await this.load(id);
    if (match.mode === 'TEAM_MATCH') this.throwTeamPlanningOnly();
    const participant = match.participants.find((item) => item.userId === userId);
    if (!participant) throw new AppError(409, 'You have not joined this match.', 'NOT_JOINED');
    const now = new Date();
    const hoursUntilKickoff = (match.startsAt.getTime() - now.getTime()) / 3_600_000;
    const initialCreditCents = getCancellationCreditCents(match.feeCents, match.startsAt, now);
    if (initialCreditCents === null)
      throw new AppError(409, 'You cannot leave once kickoff has arrived.', 'MATCH_STARTED');
    return {
      initialCreditCents,
      possibleReplacementCreditCents: match.feeCents - initialCreditCents,
      hoursUntilKickoff,
    };
  }
  async cancellationStatus(id: string, userId: string) {
    const cancellation = await this.matches.findCancellation(id, userId);
    if (!cancellation) return null;
    return {
      matchId: cancellation.matchId,
      originalTeam: cancellation.originalTeam,
      originalAmountCents: cancellation.originalAmountCents,
      initialCreditCents: cancellation.initialCreditCents,
      replacementCreditCents: cancellation.replacementCreditCents,
      replacementFound: cancellation.replacementParticipantId !== null,
      cancelledAt: cancellation.cancelledAt.toISOString(),
    };
  }
  async leave(id: string, userId: string) {
    try {
      const { cancellation, replayed } = await this.matches.cancelParticipation(
        id,
        userId,
        new Date(),
      );
      if (!replayed) domainEvents.emit('participant:left', { matchId: id, userId });
      if (cancellation && !replayed)
        await this.notifications.create(
          userId,
          'PLAYER_CANCELLED',
          'Place cancelled',
          cancellation.initialCreditCents > 0
            ? `R${(cancellation.initialCreditCents / 100).toFixed(2)} was credited to your wallet.`
            : `No credit is issued within ${CANCELLATION_CUTOFF_HOURS} hours of kickoff. Your fee will be credited if a replacement joins.`,
          `/matches/${id}`,
        );
      return cancellation;
    } catch (error) {
      if (error instanceof TeamMatchPlanningError) this.throwTeamPlanningOnly();
      if (error instanceof MatchClosedError)
        throw new AppError(409, 'You cannot leave once kickoff has arrived.', 'MATCH_STARTED');
      throw error;
    }
  }

  async updateFormation(
    id: string,
    slotId: string,
    input: FormationSlotUpdateInput,
    userId: string,
  ) {
    const match = await this.assertManager(id, userId);
    this.assertMutable(match);
    const target = match.formationSlots.find((slot) => slot.id === slotId);
    if (
      target &&
      input.positionY !== undefined &&
      ((target.team === 'HOME' && input.positionY < 50) ||
        (target.team === 'AWAY' && input.positionY > 50))
    )
      throw new AppError(
        400,
        "That position is outside the Team's half.",
        'POSITION_OUTSIDE_TEAM_HALF',
      );
    const slots =
      toMatch(await this.matches.updateFormation(id, slotId, input), {
        includeInvite: match.mode === 'QUICK_GAME',
        viewerCanManage: true,
        viewerCanChat: true,
      }).formationSlots ?? [];
    domainEvents.emit('formation:updated', { matchId: id, slots });
    return slots;
  }
  async changeTeam(
    id: string,
    participantId: string,
    input: ChangeParticipantTeamInput,
    userId: string,
  ) {
    const match = await this.load(id);
    try {
      const participant = await this.matches.changeTeam(
        id,
        participantId,
        userId,
        match.createdById === userId,
        input.team,
      );
      const dto = toMatchParticipant(participant);
      domainEvents.emit('participant:team-changed', { matchId: id, participant: dto });
      return dto;
    } catch (error) {
      if (error instanceof TeamMatchPlanningError) this.throwTeamPlanningOnly();
      if (error instanceof TeamFullError)
        throw new AppError(409, 'That team is full.', 'TEAM_FULL');
      if (error instanceof MatchClosedError)
        throw new AppError(409, 'Teams cannot change after kickoff.', 'MATCH_STARTED');
      if (error instanceof Error && error.message === 'ON_FIELD_SWITCH')
        throw new AppError(409, 'Move to reserves before switching teams.', 'ON_FIELD_SWITCH');
      if (error instanceof Error && error.message === 'PLAYER_FORBIDDEN')
        throw new AppError(403, 'You cannot move another player.', 'PLAYER_FORBIDDEN');
      if (error instanceof Error && error.message === 'PARTICIPANT_NOT_FOUND')
        throw new AppError(404, 'Participant not found.', 'PARTICIPANT_NOT_FOUND');
      throw error;
    }
  }
  async submitResult(id: string, input: ResultInput, userId: string) {
    const match = await this.assertManager(id, userId);
    if (
      getEffectiveMatchStatus({
        status: match.status === 'FULL' ? 'OPEN' : match.status,
        startsAt: match.startsAt,
        durationMinutes: match.durationMinutes,
      }) !== 'AWAITING_RESULT'
    )
      throw new AppError(
        409,
        'Results can be submitted after the match timer ends.',
        'RESULT_NOT_READY',
      );
    try {
      const completed = toMatch(await this.matches.submitResult(id, userId, input), {
        includeInvite: match.mode === 'QUICK_GAME',
        viewerCanManage: true,
        viewerCanChat: true,
      });
      domainEvents.emit('match:result-submitted', { matchId: id, result: completed.result });
      const recipients = new Set([
        match.createdById,
        ...match.participants.map(({ userId: participantUserId }) => participantUserId),
      ]);
      await Promise.all(
        [...recipients].map((recipientId) =>
          this.notifications.create(
            recipientId,
            'RESULT_SUBMITTED',
            'Result submitted',
            `Final score: Home ${input.homeScore}-${input.awayScore} Away.`,
            `/matches/${id}`,
          ),
        ),
      );
      return completed;
    } catch (error) {
      if (error instanceof Error && error.message === 'SCORER_TOTAL_MISMATCH')
        throw new AppError(
          400,
          'Scorer goal totals must equal the final scores.',
          'SCORER_TOTAL_MISMATCH',
        );
      if (error instanceof Error && error.message === 'INVALID_SCORER')
        throw new AppError(
          400,
          'Every scorer must have participated in this match.',
          'INVALID_SCORER',
        );
      throw error;
    }
  }
  async participants(id: string, userId: string) {
    return (await this.get(id, userId)).participants ?? [];
  }

  private async load(id: string) {
    const match = await this.matches.findById(id);
    if (!match) throw new AppError(404, 'Match lobby not found.', 'MATCH_NOT_FOUND');
    return match;
  }
  private async assertManager(id: string, userId: string) {
    const match = await this.load(id);
    if (match.mode === 'QUICK_GAME') {
      if (match.createdById !== userId)
        throw new AppError(403, 'Only the match organiser can do that.', 'HOST_REQUIRED');
      return match;
    }
    const membership = await this.matches.findAttachedTeamMembership(id, userId);
    if (!membership || !['OWNER', 'CAPTAIN'].includes(membership.role))
      throw new AppError(
        403,
        'Owner or captain permission is required for this Team fixture.',
        'TEAM_FORBIDDEN',
      );
    return match;
  }
  private assertMutable(match: Awaited<ReturnType<MatchesRepository['findById']>> & {}) {
    if (
      !match ||
      !canChangeLobby({
        status: match.status === 'FULL' ? 'OPEN' : match.status,
        startsAt: match.startsAt,
        durationMinutes: match.durationMinutes,
      })
    )
      throw new AppError(409, 'This action is unavailable after kickoff.', 'MATCH_STARTED');
  }
  private rethrowJoinError(error: unknown): never {
    if (error instanceof InsufficientBalanceError)
      throw new AppError(
        402,
        'Your wallet does not have enough funds for this match.',
        'INSUFFICIENT_BALANCE',
      );
    if (error instanceof AlreadyJoinedError)
      throw new AppError(
        409,
        'You have already joined this match or the request conflicts with an earlier payment.',
        'ALREADY_JOINED',
      );
    if (error instanceof TeamFullError) throw new AppError(409, 'That team is full.', 'TEAM_FULL');
    if (error instanceof TeamMatchPlanningError) this.throwTeamPlanningOnly();
    if (error instanceof MatchClosedError)
      throw new AppError(409, 'This match is no longer accepting players.', 'MATCH_CLOSED');
    throw error;
  }
  private throwTeamPlanningOnly(): never {
    throw new AppError(
      409,
      'Team fixtures are planning workspaces and do not use Quick Game player payments.',
      'TEAM_MATCH_PLANNING',
    );
  }
}
