import type {
  ChangeParticipantTeamInput,
  CreateMatchInput,
  DiscoveryQuery,
  FormationSlot,
  FormationSlotUpdateInput,
  FormationSnapshot,
  JoinMatchInput,
  ResultInput,
  UpdateMatchInput,
  MatchFormat, PublicMatchPreview,
} from '@footy-finder/shared';
import {
  canChangeLobby,
  isLobbyFrozen,
  getCancellationCreditCents,
  getEffectiveMatchStatus,
  isMatchAtCapacity,
  MATCH_DURATION_MINUTES,
  getMaxParticipantsPerTeam,
  getMaxMatchParticipants,
  MATCH_RULE_CONFIG,
  OTHER_SIDE_REFUSAL_MESSAGE,
  effectiveOtherSide,
} from '@footy-finder/shared';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { incrementOperationalMetric } from '../../observability/operational-metrics.js';
import { logInfo } from '../../observability/logger.js';
import { goNoGoFacts, toFormationSlot, toMatch, toMatchParticipant, venuePhotoFacts } from './match.mapper.js';
import { createMatchInviteToken, hashMatchInviteToken } from './invite-token.js';
import {
  AlreadyJoinedError,
  FormationSlotNotFoundError,
  InsufficientBalanceError,
  GoNoGoNotDueError,
  LineupLockedError,
  MatchClosedError,
  MatchesRepository,
  NotMatchParticipantError,
  PositionAlreadyClaimedError,
  PositionWrongSideError,
  TeamFullError,
  FirstTimersOnlyError,
  TeamMatchPlanningError,
  OtherSideRefusedError,
  OwnTeamConflictError,
} from './matches.repository.js';
import { BookingsService } from '../bookings/bookings.service.js';
import { TeamMatchesService } from '../team-matches/team-matches.service.js';
import { assertCanRunTeamMatchCommand, type TeamMatchCommand } from '../team-matches/team-side-authority.js';
import { publicMatchUrl } from './public-match.js';
import { PlayerOverlapError, playerOverlapAppError } from './player-overlap.js';
import { playerHostId } from './host.js';

/** Gate 7: stable API errors for taking the other side of a team match. */
export const rethrowOtherSideError = (error: unknown) => {
  if (error instanceof OtherSideRefusedError)
    throw new AppError(
      409,
      error.reason === 'HOME_IS_A_TEAM'
        ? 'The home side of a team match is the home team. Players can only join the other side.'
        : OTHER_SIDE_REFUSAL_MESSAGE[error.reason],
      error.reason === 'TEAMS_ONLY' ? 'TEAM_MATCH_TEAMS_ONLY' : 'OTHER_SIDE_TAKEN',
    );
  if (error instanceof OwnTeamConflictError)
    throw new AppError(409, "You can't play against your own team.", 'OWN_TEAM_CONFLICT');
};

/** CEO touch-up batch 2, item 5: how many starting positions on one side are taken (never by whom). */
const sideCount = (slots: Array<{ participantId: string | null; team: 'HOME' | 'AWAY' }>, team: 'HOME' | 'AWAY') => {
  const side = slots.filter((slot) => slot.team === team);
  return { filled: side.filter(({ participantId }) => participantId).length, total: side.length };
};

export class MatchesService {
  constructor(
    private readonly matches = new MatchesRepository(),
    private readonly notifications = new NotificationsService(),
    private readonly bookings = new BookingsService(),
    private readonly teamMatches = new TeamMatchesService(),
  ) {}

  async list(query: DiscoveryQuery, now = new Date()) {
    const filtered = query.availableOnly || query.joinableOnly;
    const repositoryQuery = filtered ? { ...query, limit: 200 } : query;
    let matches = (await this.matches.listPublic(repositoryQuery)).map((match) => toMatch(match));
    // CEO touch-up batch 3, item 8: the home page lists only matches a player can still join.
    if (query.joinableOnly) matches = matches.filter((match) => !isLobbyFrozen(match, now) && new Date(match.startsAt) > now);
    if (filtered)
      matches = matches.filter(
        (match) =>
          !isMatchAtCapacity(
            match.format,
            match.substituteCapacityPerTeam,
            match.participantCount,
          ),
      );
    return matches.slice(0, query.limit);
  }
  async get(id: string, userId: string) {
    const match = await this.load(id);
    // Gate 7 / TKT-708: the viewer's own and managed side, resolved per side.
    const sides = match.mode === 'TEAM_MATCH' ? await this.matches.viewerTeamSides(id, userId) : null;
    const isParticipant = match.participants.some((item) => item.userId === userId);
    if (
      match.visibility === 'PRIVATE' &&
      playerHostId(match) !== userId &&
      !isParticipant &&
      !sides?.member &&
      !(await this.matches.hasParticipation(id, userId))
    )
      throw new AppError(
        403,
        'Use a valid invitation to access this private match.',
        'PRIVATE_MATCH',
      );
    const viewerCanManage =
      match.mode === 'QUICK_GAME'
        ? playerHostId(match) === userId
        : Boolean(sides?.managed);
    return toMatch(match, {
      viewerCanManage,
      viewerTeamSide: sides?.member ?? null,
      viewerManagedTeamSide: sides?.managed ?? null,
      viewerCanChat: playerHostId(match) === userId || isParticipant || Boolean(sides?.member),
    });
  }
  async getByInvite(token: string) {
    const match = await this.matches.findByInviteTokenHash(hashMatchInviteToken(token));
    if (!match)
      throw new AppError(404, 'Match invitation is invalid or expired.', 'INVITE_NOT_FOUND');
    return toMatch(match);
  }
  async getByPublicSlug(slug: string, userId: string) {
    const match = await this.matches.findPublicBySlug(slug);
    if (!match)
      throw new AppError(404, 'Public match not found.', 'PUBLIC_MATCH_NOT_FOUND');
    return this.get(match.id, userId);
  }
  async publicPreview(slug: string): Promise<PublicMatchPreview> {
    const match = await this.matches.findPublicPreviewBySlug(slug);
    if (!match)
      throw new AppError(404, 'Public match not found.', 'PUBLIC_MATCH_NOT_FOUND');
    return this.toPublicPreview(match);
  }
  async publicPreviewById(id: string): Promise<PublicMatchPreview> {
    const match = await this.matches.findPublicPreviewById(id);
    if (!match)
      throw new AppError(404, 'Public match not found.', 'PUBLIC_MATCH_NOT_FOUND');
    return this.toPublicPreview(match);
  }
  /** Gate 9 / TKT-910: upcoming public matches anyone can browse (counts only, no names). */
  async publicList(query: { format?: MatchFormat } = {}, now = new Date()) {
    const matches = await this.matches.findPublicPreviews({
      status: { in: ['OPEN', 'READY'] },
      startsAt: { gt: now },
      OR: [{ mode: 'QUICK_GAME' }, { otherSideMode: { not: null } }],
      ...(query.format ? { format: query.format } : {}),
    });
    return matches.map((match) => this.toPublicPreview(match));
  }
  private toPublicPreview(match: NonNullable<Awaited<ReturnType<MatchesRepository['findPublicPreviewBySlug']>>>): PublicMatchPreview {
    const slug = match.publicSlug!;
    const filled = match.participants.length;
    // Gate 7: on a team match individuals can only ever fill the other side.
    const teamMatch = Boolean(match.otherSideMode);
    const total = teamMatch
      ? getMaxParticipantsPerTeam(match.format, match.substituteCapacityPerTeam)
      : getMaxMatchParticipants(match.format, match.substituteCapacityPerTeam);
    const individualSlots = teamMatch ? match.formationSlots.filter(({ team }) => team === 'AWAY') : match.formationSlots;
    const otherSide = teamMatch ? effectiveOtherSide(match.otherSideTakenBy, filled) : null;
    const lifecycleStatus = getEffectiveMatchStatus({
      status: match.status,
      startsAt: match.startsAt,
      durationMinutes: match.durationMinutes,
    });
    const status =
      ['OPEN', 'READY'].includes(lifecycleStatus) && filled >= total ? 'FULL' : lifecycleStatus;
    const lineupLocked = ['OPEN', 'READY', 'FULL'].includes(status) && isLobbyFrozen(match);
    const reason =
      status === 'CANCELLED' ? 'CANCELLED'
        : lineupLocked ? 'LINEUP_LOCKED'
        : teamMatch && otherSide === 'TEAM' && ['OPEN', 'READY', 'FULL'].includes(status) ? 'TAKEN_BY_TEAM'
        : teamMatch && match.otherSideMode === 'TEAMS_ONLY' && ['OPEN', 'READY', 'FULL'].includes(status) ? 'TEAMS_ONLY'
        : status === 'FULL' ? 'FULL'
          : ['IN_PROGRESS'].includes(status) ? 'STARTED'
            : ['AWAITING_RESULT', 'COMPLETED'].includes(status) ? 'COMPLETED'
              : ['OPEN', 'READY'].includes(status) ? 'AVAILABLE'
                : 'UNAVAILABLE';
    return {
      slug,
      canonicalUrl: publicMatchUrl(slug),
      name: match.name,
      ...(match.description ? { description: match.description } : {}),
      venue: { name: match.venue.name, city: match.venue.city, region: match.venue.region, ...venuePhotoFacts(match.fieldReservation?.field?.venue) },
      startsAt: match.startsAt.toISOString(),
      durationMinutes: match.durationMinutes,
      format: match.format,
      feeCents: match.feeCents,
      freeOnFootyFinder: match.freeOnFootyFinder,
      firstTimersOnly: match.firstTimersOnly,
      hostedByFootyFinder: match.hostedByFootyFinder,
      currency: 'ZAR',
      rules: match.rules.map((code) => ({ code, label: MATCH_RULE_CONFIG[code].label })),
      status,
      joinability: { canJoin: reason === 'AVAILABLE', reason },
      capacity: { filled, total },
      substitutesPerTeam: match.substituteCapacityPerTeam,
      positions: {
        filled: individualSlots.filter(({ participantId }) => participantId).length,
        total: individualSlots.length,
      },
      sides: {
        home: sideCount(match.formationSlots, 'HOME'),
        away: sideCount(match.formationSlots, 'AWAY'),
      },
      ...(match.otherSideMode && {
        teamMatch: {
          homeTeamName: match.teamSides.find(({ side }) => side === 'HOME')?.teamNameSnapshot ?? '',
          ...(otherSide === 'TEAM' && { awayTeamName: match.teamSides.find(({ side }) => side === 'AWAY')?.teamNameSnapshot }),
          otherSideMode: match.otherSideMode,
          otherSideTakenBy: otherSide,
        },
      }),
      ...goNoGoFacts(match),
      ...(match.result && match.result.finalSource !== 'LEGACY' && ['AWAITING_RESULT', 'COMPLETED'].includes(match.status) && {
        result: {
          homeName: match.teamSides.find(({ side }) => side === 'HOME')?.teamNameSnapshot ?? 'Home',
          awayName: match.teamSides.find(({ side }) => side === 'AWAY')?.teamNameSnapshot ?? 'Away',
          homeScore: match.result.homeScore,
          awayScore: match.result.awayScore,
          outcome: match.result.outcomeType,
          forfeitWinner: match.result.forfeitWinner,
          goals: match.result.goals.map((goal) => ({
            side: goal.side,
            ownGoal: goal.ownGoal,
            scorer: goal.scorer?.displayNameSnapshot ?? null,
            assister: goal.assist?.displayNameSnapshot ?? null,
          })),
        },
      }),
    };
  }
  /** Quick Match, or (Gate 7 / DEC-019) a team match when the host plays as their team. */
  async create(input: CreateMatchInput, userId: string) {
    if (input.playAsTeamId) return this.teamMatches.create(input, userId);
    return this.bookings.createQuickMatch(input, userId);
  }
  async rotateInvite(id: string, userId: string) {
    const match = await this.assertManager(id, userId);
    if (match.mode !== 'QUICK_GAME' || match.visibility !== 'PRIVATE')
      throw new AppError(
        409,
        'Invitation links are available only for private Quick Games.',
        'MATCH_INVITE_UNAVAILABLE',
      );
    this.assertMutable(match);
    const inviteToken = createMatchInviteToken();
    return toMatch(await this.matches.rotateInviteToken(id, hashMatchInviteToken(inviteToken)), {
      inviteToken,
      viewerCanManage: true,
      viewerCanChat: true,
    });
  }
  async update(id: string, input: UpdateMatchInput, userId: string) {
    const match = await this.assertManager(id, userId, 'UPDATE_MATCH');
    this.assertMutable(match);
    if (input.startsAt && new Date(input.startsAt).getTime() <= Date.now())
      throw new AppError(
        400,
        'Choose a future date and time for kickoff.',
        'MATCH_START_TIME_INVALID',
      );
    if (input.startsAt && (await this.matches.hasFieldReservation(id)))
      throw new AppError(
        409,
        'A managed venue slot cannot be rescheduled. Cancel it and choose a new live slot.',
        'MANAGED_SLOT_IMMUTABLE',
      );
    const updated = toMatch(await this.matches.update(id, input), {
      viewerCanManage: true,
      viewerCanChat: true,
    });
    emitDomainEventBestEffort('match:updated', { matchId: id });
    return updated;
  }
  async ready(id: string, userId: string) {
    const match = await this.assertManager(id, userId, 'UPDATE_MATCH');
    if (match.mode === 'TEAM_MATCH')
      throw new AppError(
        409,
        'Team fixtures remain planning drafts until booking and funding are available.',
        'TEAM_MATCH_DRAFT',
      );
    this.assertMutable(match);
    const ready = toMatch(await this.matches.markReady(id), {
      viewerCanManage: true,
      viewerCanChat: true,
    });
    emitDomainEventBestEffort('match:ready', { matchId: id });
    return ready;
  }

  async remove(id: string, userId: string) {
    // Gate 7 (D6 as narrowed by N5): only the home team cancels a team match, for both sides.
    const match = await this.assertManager(id, userId, 'CANCEL_MATCH');
    if (match.status === 'CANCELLED') return;
    this.assertMutable(match);
    const { notifications } = await this.matches.cancelMatch(
      id,
      match.otherSideMode ? 'TEAM_CANCELLED' : 'ORGANISER_CANCELLED',
      userId,
    );
    this.notifications.publishPersistedMany(notifications);
    emitDomainEventBestEffort('match:cancelled', { matchId: id });
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
      const participant = toMatchParticipant(result.participant);
      if (!result.replayed) {
        emitDomainEventBestEffort('participant:joined', {
          matchId: id,
          participant,
        });
      }
      this.notifications.publishPersistedMany(result.notifications);
      return participant;
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
      const { cancellation, replayed, notifications } = await this.matches.cancelParticipation(
        id,
        userId,
        new Date(),
      );
      if (!replayed) emitDomainEventBestEffort('participant:left', { matchId: id, userId });
      this.notifications.publishPersistedMany(notifications);
      return cancellation;
    } catch (error) {
      if (error instanceof TeamMatchPlanningError) this.throwTeamPlanningOnly();
      if (error instanceof LineupLockedError) this.throwLineupLocked();
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
    // CEO batch 1: each Quick Match side has its own pitch, so the Host may place a marker anywhere
    // on it (0-100, validated by the schema). Only the Host reaches this point (assertManager).
    const result = await this.matches.updateFormation(id, slotId, input, userId);
    const slots = result.match.formationSlots.map(toFormationSlot);
    if (result.changed) this.publishFormation(id, result.match.formationVersion, slots);
    this.notifications.publishPersistedMany(result.notifications);
    return slots;
  }

  /** DEC-013 self-claim: a joined participant takes an open position on their own side. */
  async claimPosition(id: string, slotId: string, userId: string): Promise<FormationSnapshot> {
    try {
      const result = await this.matches.claimPosition(id, slotId, userId);
      const snapshot = {
        matchId: id,
        formationVersion: result.match.formationVersion,
        slots: result.match.formationSlots.map(toFormationSlot),
      };
      if (!result.replayed) {
        incrementOperationalMetric('position_claims_total');
        this.publishFormation(id, snapshot.formationVersion, snapshot.slots);
      }
      return snapshot;
    } catch (error) {
      if (error instanceof PositionAlreadyClaimedError) {
        incrementOperationalMetric('position_claim_conflicts_total');
        logInfo('position_claim_failed', { matchId: id, slotId, reason: 'POSITION_ALREADY_CLAIMED' });
        const current = await this.load(id);
        throw new AppError(409, 'Another player has already claimed that position.', 'POSITION_ALREADY_CLAIMED', {
          matchId: id,
          formationVersion: current.formationVersion,
          slots: current.formationSlots.map(toFormationSlot),
        } satisfies FormationSnapshot);
      }
      if (error instanceof FormationSlotNotFoundError)
        throw new AppError(404, 'That position does not exist in this match.', 'FORMATION_SLOT_NOT_FOUND');
      if (error instanceof TeamMatchPlanningError) this.throwTeamPlanningOnly();
      if (error instanceof LineupLockedError) this.throwLineupLocked();
      if (error instanceof MatchClosedError)
        throw new AppError(409, 'Positions cannot change after kickoff.', 'MATCH_STARTED');
      if (error instanceof NotMatchParticipantError)
        throw new AppError(403, 'Join this match before claiming a position.', 'MATCH_PARTICIPANT_REQUIRED');
      if (error instanceof PositionWrongSideError)
        throw new AppError(403, 'You can only claim a position on your own team.', 'POSITION_WRONG_SIDE');
      throw error;
    }
  }

  /**
   * DEC-018 T-30 go/no-go for one match (durable QUICK_MATCH_GO_NO_GO job). Idempotent: a repeat
   * or late run returns ALREADY_DECIDED without moving money. GoNoGoNotDueError propagates so the
   * durable queue retries a job that somehow ran early.
   */
  async decideGoNoGo(matchId: string, now = new Date()) {
    try {
      const result = await this.matches.decideGoNoGo(matchId, now);
      this.notifications.publishPersistedMany(result.notifications);
      if (result.outcome === 'CONFIRMED') {
        incrementOperationalMetric('go_no_go_confirmed_total');
        emitDomainEventBestEffort('match:updated', { matchId });
      } else if (result.outcome === 'CANCELLED') {
        incrementOperationalMetric('go_no_go_cancelled_total');
        emitDomainEventBestEffort('match:cancelled', { matchId });
      }
      logInfo('go_no_go_decided', {
        matchId,
        outcome: result.outcome,
        filled: result.filled,
        total: result.total,
      });
      return result;
    } catch (error) {
      if (error instanceof GoNoGoNotDueError)
        throw Object.assign(new Error('Go/no-go check ran before its due time.'), {
          code: 'GO_NO_GO_NOT_DUE',
        });
      throw error;
    }
  }

  /** TKT-319: "not full yet" reminder; toasts are published after the transaction commits. No email. */
  async sendFillReminder(matchId: string) {
    const result = await this.matches.sendFillReminder(matchId);
    this.notifications.publishPersistedMany(result.notifications);
    if (result.notifications.length)
      logInfo('fill_reminder_sent', { matchId, open: result.open, recipients: result.notifications.length });
    return result;
  }

  /** Called only after the formation transaction commits. */
  private publishFormation(matchId: string, formationVersion: number, slots: FormationSlot[]) {
    emitDomainEventBestEffort('formation:updated', { matchId, slots });
    emitDomainEventBestEffort('match-formation:updated', {
      matchId,
      formationVersion,
      slots,
    } satisfies FormationSnapshot);
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
        playerHostId(match) === userId,
        input.team,
      );
      const dto = toMatchParticipant(participant);
      emitDomainEventBestEffort('participant:team-changed', { matchId: id, participant: dto });
      return dto;
    } catch (error) {
      if (error instanceof TeamMatchPlanningError) this.throwTeamPlanningOnly();
      if (error instanceof TeamFullError)
        throw new AppError(409, 'That team is full.', 'TEAM_FULL');
      if (error instanceof LineupLockedError) this.throwLineupLocked();
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
    const match = await this.assertManager(id, userId, 'SUBMIT_RESULT');
    // Gate 8 (DEC-020): a match with a T-30 go/no-go has a FootyFinder referee, whose result is
    // final. Hosts and captains may only send their own version as evidence (TKT-806).
    if (match.goNoGoAt)
      throw new AppError(409, 'The FootyFinder referee records the result of this match.', 'RESULT_BY_REFEREE');
    if (
      getEffectiveMatchStatus({
        status: match.status,
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
      const result = await this.matches.submitResult(id, userId, input);
      const completed = toMatch(result.match, {
        viewerCanManage: true,
        viewerCanChat: true,
      });
      emitDomainEventBestEffort('match:result-submitted', {
        matchId: id,
        result: completed.result,
      });
      this.notifications.publishPersistedMany(result.notifications);
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
  private async assertManager(id: string, userId: string, command: TeamMatchCommand = 'UPDATE_MATCH') {
    const match = await this.load(id);
    if (match.mode === 'QUICK_GAME') {
      // CEO touch-up batch 3.5, item 5: nobody is the host of a FootyFinder-hosted match in the player app.
      if (playerHostId(match) !== userId)
        throw new AppError(403, 'Only the match organiser can do that.', 'HOST_REQUIRED');
      return match;
    }
    // Gate 7 / TKT-708: a team match command is run only by a manager of the side that owns it.
    assertCanRunTeamMatchCommand(command, await this.matches.managedTeamSides(id, userId));
    return match;
  }
  private assertMutable(match: Awaited<ReturnType<MatchesRepository['findById']>> & {}) {
    if (
      !match ||
      !canChangeLobby({
        status: match.status,
        startsAt: match.startsAt,
        durationMinutes: match.durationMinutes,
      })
    )
      throw new AppError(409, 'This action is unavailable after kickoff.', 'MATCH_STARTED');
    // DEC-018 (D1): from the go/no-go instant the lobby is frozen, including organiser edits and
    // host cancellation (D3).
    if (isLobbyFrozen(match)) this.throwLineupLocked();
  }
  private throwLineupLocked(): never {
    throw new AppError(
      409,
      'The lineup locked 30 minutes before kickoff for the go/no-go check.',
      'LINEUP_LOCKED',
    );
  }
  private rethrowJoinError(error: unknown): never {
    if (error instanceof PlayerOverlapError) throw playerOverlapAppError(error);
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
    if (error instanceof FirstTimersOnlyError)
      throw new AppError(409, 'This free match is for players who have never played a match on FootyFinder.', 'FIRST_TIMERS_ONLY');
    rethrowOtherSideError(error);
    if (error instanceof TeamMatchPlanningError) this.throwTeamPlanningOnly();
    if (error instanceof LineupLockedError) this.throwLineupLocked();
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
