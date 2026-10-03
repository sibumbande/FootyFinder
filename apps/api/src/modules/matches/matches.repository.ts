import type {
  CreateTeamMatchInput,
  DiscoveryQuery,
  MatchCancellationReason,
  FormationSlotUpdateInput,
  ResultInput,
  UpdateMatchInput,
} from '@footy-finder/shared';
import {
  type OtherSideRefusal,
  createDefaultFormation,
  getMaxParticipantsPerTeam,
  isLobbyFrozen,
} from '@footy-finder/shared';
import type { Notification, Prisma } from '../../generated/prisma/client.js';
import { serializableTransaction } from '../../database/transaction.js';
import { prisma } from '../../database/prisma.js';
import {
  notificationDedupeKey,
  persistNotifications,
  type NotificationDraft,
} from '../notifications/notification-writer.js';
import { matchInclude, participantInclude } from './match.query.js';
import { matchCancelledMessage } from './cancellation-message.js';
import { enqueueMatchCancelledEmail } from './match-cancelled-email.js';
import { fillReminderMessage, openPositionsForReminder } from './fill-reminder.js';
import { copySavedSquad } from '../team-matches/team-squad.js';
import { appendTeamMatchAudit } from '../team-matches/team-match-audit.js';
import { managedTeamSides } from '../team-matches/team-side-authority.js';
import { hasActiveReferee } from '../referees/referee-assignment.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { reversePromotionalCosts } from './free-matches.js';
import { hostAudience } from './host.js';
import { settleTicketsOnCancellationInTx } from '../tickets/ticket-cancellation.js';

export class TeamFullError extends Error {}
/** CEO touch-up batch 3, item 5: this free match is for players who have never played a match. */
export class MatchClosedError extends Error {}
/** DEC-018 (D1): the lobby is frozen from the go/no-go instant (T-30) until kickoff. */
export class LineupLockedError extends Error {}
/** The go/no-go job ran before the match's go/no-go instant; the durable queue retries it. */
export class GoNoGoNotDueError extends Error {}
export class TeamFixtureForbiddenError extends Error {}
export class TeamFixtureTeamNotFoundError extends Error {}
export class TeamMatchPlanningError extends Error {}
export class FormationSlotNotFoundError extends Error {}
export class NotMatchParticipantError extends Error {}
export class PositionWrongSideError extends Error {}
export class PositionAlreadyClaimedError extends Error {}
/** DEC-021 A1.2: someone is paying for this position right now. */
export class PositionBeingBookedError extends Error {}
/** Gate 7 / DEC-019: the other side of a team match cannot be taken this way right now. */
export class OtherSideRefusedError extends Error {
  constructor(readonly reason: OtherSideRefusal | 'HOME_IS_A_TEAM') {
    super(reason);
  }
}
/** Gate 7 / N2: nobody can play against their own team. */
export class OwnTeamConflictError extends Error {}
/** CEO Q4: why an admin "Cancel match (weather/venue)" was refused. */
export class AdminCancelRefusedError extends Error {
  constructor(readonly reason: 'MATCH_NOT_FOUND' | 'ALREADY_CANCELLED' | 'MATCH_STARTED' | 'TEAM_MATCH_LOCKED') {
    super(reason);
  }
}

/**
 * Takes the Match row lock that every formation mutation shares, so claims and organiser moves
 * on one Match serialize in a consistent lock order (Match, then slots).
 */
export const lockMatchForFormation = (tx: Prisma.TransactionClient, matchId: string) =>
  tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId}::uuid FOR UPDATE`;

export const bumpFormationVersion = async (tx: Prisma.TransactionClient, matchId: string) =>
  (
    await tx.match.update({
      where: { id: matchId },
      data: { formationVersion: { increment: 1 } },
      select: { formationVersion: true },
    })
  ).formationVersion;

const isLobbyOpen = (
  match: { mode: string; status: string; startsAt: Date; durationMinutes: number; otherSideMode?: string | null },
  now: Date,
) =>
  // Gate 7: individuals may also join, leave and claim on the open side of a DEC-019 team match.
  (match.mode === 'QUICK_GAME' || Boolean(match.otherSideMode)) &&
  ['OPEN', 'READY'].includes(match.status) &&
  now < match.startsAt;

/**
 * Throws LineupLockedError once a DEC-018 match reaches its go/no-go instant (distinct from a
 * started/closed match), or MatchClosedError when the lobby is otherwise closed.
 */
export const assertLobbyOpen = (
  match: { mode: string; status: string; startsAt: Date; durationMinutes: number; goNoGoAt?: Date | null; otherSideMode?: string | null },
  now: Date,
) => {
  if (isLobbyOpen(match, now) && isLobbyFrozen(match, now)) throw new LineupLockedError();
  if (!isLobbyOpen(match, now)) throw new MatchClosedError();
};

/** Guest-safe public match fields (no people before the result; no money beyond the fixed fee). */
export const publicPreviewSelect = {
  publicSlug: true,
  name: true,
  description: true,
  format: true,
  substituteCapacityPerTeam: true,
  rules: true,
  status: true,
  startsAt: true,
  durationMinutes: true,
  feeCents: true,
  freeOnFootyFinder: true,
  hostedByFootyFinder: true,
  girlsOnly: true,
  firstTimersOnly: true,
  venue: { select: { name: true, city: true, region: true } },
  // CEO touch-up batch 3, item 1: the venue page and cover photo only (DEC-018: never prices or policies).
  fieldReservation: { select: { field: { select: { venue: { select: { slug: true, coverImageUrl: true, coverImageAlt: true } } } } } },
  participants: { where: { status: 'JOINED' }, select: { id: true } },
  goNoGoAt: true,
  confirmedAt: true,
  cancellationReason: true,
  formationSlots: { select: { participantId: true, team: true } },
  otherSideMode: true,
  otherSideTakenBy: true,
  teamSides: { select: { side: true, teamNameSnapshot: true } },
  // Gate 9 / TKT-910: the final result with scorer and assister names, once a referee or admin has recorded it.
  result: {
    select: {
      homeScore: true, awayScore: true, outcomeType: true, forfeitWinner: true, finalSource: true,
      goals: { orderBy: { sortOrder: 'asc' }, select: { side: true, ownGoal: true, scorer: { select: { displayNameSnapshot: true, user: { select: { accountStatus: true } } } }, assist: { select: { displayNameSnapshot: true, user: { select: { accountStatus: true } } } } } },
    },
  },
} satisfies Prisma.MatchSelect;

export class MatchesRepository {
  listPublic(query: DiscoveryQuery) {
    return prisma.match.findMany({
      where: {
        // Gate 7 / DEC-019: public team matches are listed alongside Quick Matches.
        OR: [{ mode: 'QUICK_GAME' }, { mode: 'TEAM_MATCH', otherSideMode: { not: null } }],
        visibility: 'PUBLIC',
        status: { in: ['OPEN', 'READY'] },
        startsAt: {
          gte: query.dateFrom ? new Date(query.dateFrom) : new Date(),
          lte: query.dateTo ? new Date(query.dateTo) : undefined,
        },
        format: query.format,
      },
      include: matchInclude,
      orderBy: { startsAt: 'asc' },
      take: query.limit,
    });
  }
  findById(id: string) {
    return prisma.match.findUnique({ where: { id }, include: matchInclude });
  }
  findPublicBySlug(publicSlug: string) {
    return prisma.match.findFirst({
      where: { publicSlug, visibility: 'PUBLIC' },
      include: matchInclude,
    });
  }
  findPublicPreviewBySlug(publicSlug: string) {
    return prisma.match.findFirst({ where: { publicSlug, visibility: 'PUBLIC' }, select: publicPreviewSelect });
  }
  /** CEO touch-up batch 2, item 5: the same guest view, for a guest who opens a /matches/:id link. */
  findPublicPreviewById(id: string) {
    return prisma.match.findFirst({ where: { id, visibility: 'PUBLIC', publicSlug: { not: null } }, select: publicPreviewSelect });
  }
  /** Gate 9 / TKT-910: upcoming public matches for the guest match list. */
  findPublicPreviews(where: Prisma.MatchWhereInput, take = 50) {
    return prisma.match.findMany({ where: { ...where, visibility: 'PUBLIC', publicSlug: { not: null } }, select: publicPreviewSelect, orderBy: { startsAt: 'asc' }, take });
  }
  hasFieldReservation(matchId: string) {
    return prisma.fieldReservation.findUnique({ where: { matchId }, select: { id: true } });
  }
  findByInviteTokenHash(inviteTokenHash: string) {
    return prisma.match.findUnique({ where: { inviteTokenHash }, include: matchInclude });
  }
  hasParticipation(matchId: string, userId: string) {
    return prisma.matchParticipant.findUnique({
      where: { matchId_userId: { matchId, userId } },
      select: { id: true },
    });
  }
  /** Gate 7 / TKT-708: the sides of this match whose team the user owns or captains. */
  managedTeamSides(matchId: string, userId: string) {
    return managedTeamSides(prisma, matchId, userId);
  }
  /** Gate 7: the side(s) of a team match the viewer is a member of, and the side they manage. */
  async viewerTeamSides(matchId: string, userId: string) {
    const sides = await prisma.matchTeam.findMany({
      where: { matchId, team: { memberships: { some: { userId } } } },
      select: { side: true, team: { select: { memberships: { where: { userId }, select: { role: true } } } } },
      orderBy: { side: 'asc' },
    });
    const managed = sides.find((side) => side.team?.memberships.some(({ role }) => role === 'OWNER' || role === 'CAPTAIN'));
    return { member: sides[0]?.side ?? null, managed: managed?.side ?? null };
  }

  listForTeam(teamId: string) {
    return prisma.match.findMany({
      where: { mode: 'TEAM_MATCH', teamSides: { some: { teamId } } },
      include: matchInclude,
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  createTeamFixture(
    teamId: string,
    input: CreateTeamMatchInput,
    userId: string,
    durationMinutes: number,
  ) {
    return serializableTransaction(async (tx) => {
      const team = await tx.team.findUnique({
        where: { id: teamId },
        include: {
          memberships: { where: { userId }, select: { role: true } },
          formations: {
            where: { format: input.format },
            include: {
              slots: {
                include: { membership: { select: { userId: true } } },
                orderBy: { slotIndex: 'asc' },
              },
            },
          },
        },
      });
      if (!team) throw new TeamFixtureTeamNotFoundError();
      if (!team.memberships.some(({ role }) => role === 'OWNER' || role === 'CAPTAIN'))
        throw new TeamFixtureForbiddenError();
      const match = await tx.match.create({
        data: {
          name: input.name,
          description: input.description,
          createdBy: { connect: { id: userId } },
          mode: 'TEAM_MATCH',
          format: input.format,
          substituteCapacityPerTeam: input.substituteCapacityPerTeam,
          rollingSubstitutes: input.rollingSubstitutes,
          rules: input.rules,
          visibility: 'PRIVATE',
          startsAt: new Date(input.startsAt),
          durationMinutes,
          feeCents: 0,
          currency: 'ZAR',
          status: 'DRAFT',
          venue: { create: input.venue },
          formationSlots: { create: createDefaultFormation(input.format) },
          teamSides: {
            create: {
              team: { connect: { id: teamId } },
              side: 'HOME',
              organisingUser: { connect: { id: userId } },
              formationKey: input.formationKey,
              teamNameSnapshot: team.name,
              teamImageUrlSnapshot: team.profileImageUrl,
              primaryColorSnapshot: team.primaryColor,
              secondaryColorSnapshot: team.secondaryColor,
            },
          },
        },
        include: matchInclude,
      });
      await copySavedSquad(tx, {
        matchTeamId: match.teamSides[0]!.id,
        teamId,
        side: 'HOME',
        format: input.format,
        formationKey: input.formationKey,
        actorUserId: userId,
      });
      return tx.match.findUniqueOrThrow({ where: { id: match.id }, include: matchInclude });
    });
  }

  rotateInviteToken(id: string, inviteTokenHash: string) {
    return prisma.match.update({
      where: { id },
      data: { inviteToken: null, inviteTokenHash },
      include: matchInclude,
    });
  }
  update(id: string, input: UpdateMatchInput) {
    return prisma.match.update({
      where: { id },
      data: { ...input, startsAt: input.startsAt ? new Date(input.startsAt) : undefined },
      include: matchInclude,
    });
  }
  markReady(id: string) {
    return prisma.match.update({ where: { id }, data: { status: 'READY' }, include: matchInclude });
  }

  /**
   * Organiser cancellation (D3: allowed until the go/no-go instant; enforced by the service), or
   * (Gate 7) the home team cancelling a team match, audited with its actor.
   */
  cancelMatch(matchId: string, reason: 'ORGANISER_CANCELLED' | 'TEAM_CANCELLED' = 'ORGANISER_CANCELLED', actorUserId?: string) {
    return serializableTransaction(async (tx) => {
      const cancelled = await this.cancelInTx(tx, matchId, reason);
      if (reason === 'TEAM_CANCELLED')
        await appendTeamMatchAudit(tx, { matchId, command: 'TEAM_MATCH_CANCELLED', side: 'HOME', actorUserId, payload: { reason } });
      return cancelled;
    });
  }

  /**
   * CEO Q4: an admin cancels a match for the weather or a venue problem, through the same
   * cancelInTx core (every payer chooses a match credit or a full refund, in-app + email notices, nothing owed
   * to the venue), audited with the admin's written reason. Only before kick-off; a team match only
   * before its T-30 check (the split window stays, CEO Q4). The referee is told in the app.
   */
  cancelByFootyFinder(matchId: string, adminUserId: string, reason: string, requestId: string, now = new Date()) {
    return serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: { status: true, startsAt: true, goNoGoAt: true, confirmedAt: true, otherSideMode: true, refereeUserId: true, venue: { select: { name: true } } },
      });
      if (!match) throw new AdminCancelRefusedError('MATCH_NOT_FOUND');
      if (match.status === 'CANCELLED') throw new AdminCancelRefusedError('ALREADY_CANCELLED');
      if (!['DRAFT', 'OPEN', 'READY'].includes(match.status) || now >= match.startsAt)
        throw new AdminCancelRefusedError('MATCH_STARTED');
      if (match.otherSideMode && (match.confirmedAt || (match.goNoGoAt && now >= match.goNoGoAt)))
        throw new AdminCancelRefusedError('TEAM_MATCH_LOCKED');
      const cancelled = await this.cancelInTx(tx, matchId, 'FOOTYFINDER_CANCELLED');
      if (match.otherSideMode)
        await appendTeamMatchAudit(tx, { matchId, command: 'TEAM_MATCH_CANCELLED', side: 'HOME', actorUserId: adminUserId, payload: { reason: 'FOOTYFINDER_CANCELLED' } });
      await appendAdminAudit(tx, {
        actorUserId: adminUserId,
        action: 'MATCH_CANCELLED_BY_FOOTYFINDER',
        entityType: 'MATCH',
        entityId: matchId,
        requestId,
        metadata: { reason, payersAskedToChoose: cancelled.payerIds.length, teamMatch: Boolean(match.otherSideMode) },
      });
      const refereeNotice = match.refereeUserId
        ? await persistNotifications(tx, [{
            userId: match.refereeUserId,
            type: 'MATCH_CANCELLED',
            title: 'Match cancelled',
            message: matchCancelledMessage({ venueName: match.venue.name, startsAt: match.startsAt, reason: 'FOOTYFINDER_CANCELLED' }),
            targetPath: `/referee/matches/${matchId}`,
            dedupeKey: notificationDedupeKey('match', matchId, 'match-cancelled', match.refereeUserId),
          }])
        : [];
      return { ...cancelled, notifications: [...cancelled.notifications, ...refereeNotice] };
    });
  }

  /**
   * DEC-018 T-30 go/no-go, run by the durable QUICK_MATCH_GO_NO_GO job. Idempotent and safe to run
   * more than once or late (after a restart): the lobby is frozen from goNoGoAt, so the formation
   * it evaluates is exactly the formation at T-30.
   * - Every formation position claimed: the match is confirmed (subs are optional).
   * - Otherwise: the match is cancelled and every paid fee is refunded in full, once.
   */
  decideGoNoGo(matchId: string, now = new Date()) {
    return serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: {
          id: true,
          mode: true,
          status: true,
          goNoGoAt: true,
          confirmedAt: true,
          createdById: true,
          hostedByFootyFinder: true,
          formationSlots: { select: { participantId: true } },
          participants: { where: { status: 'JOINED' }, select: { userId: true } },
        },
      });
      const none = { notifications: [] as Notification[], filled: 0, total: 0 };
      if (!match || match.mode !== 'QUICK_GAME' || !match.goNoGoAt)
        return { outcome: 'NOT_APPLICABLE' as const, ...none };
      if (match.status === 'CANCELLED' || match.confirmedAt)
        return { outcome: 'ALREADY_DECIDED' as const, ...none };
      if (!['OPEN', 'READY'].includes(match.status))
        return { outcome: 'NOT_APPLICABLE' as const, ...none };
      if (now < match.goNoGoAt) throw new GoNoGoNotDueError();
      const total = match.formationSlots.length;
      const filled = match.formationSlots.filter(({ participantId }) => participantId).length;
      // Gate 8 (DEC-020, D2): the match also needs an active FootyFinder referee.
      const positionsFilled = total > 0 && filled === total;
      const refereeReady = await hasActiveReferee(tx, matchId);
      if (positionsFilled && refereeReady) {
        await tx.match.update({ where: { id: matchId }, data: { confirmedAt: now } });
        const recipients = [
          ...new Set([...match.participants.map(({ userId }) => userId), ...hostAudience(match)]),
        ];
        const notifications = await persistNotifications(
          tx,
          recipients.map((userId) => ({
            userId,
            type: 'MATCH_CONFIRMED' as const,
            title: 'Match confirmed',
            message: 'Every position is filled, so the match goes ahead.',
            targetPath: `/matches/${matchId}`,
            dedupeKey: notificationDedupeKey('match', matchId, 'go-no-go-confirmed', userId),
          })),
        );
        return { outcome: 'CONFIRMED' as const, notifications, filled, total, refereeReady };
      }
      // D23: the players' own reason comes first; 'no referee' only when that was the sole problem.
      const reason = positionsFilled ? 'NO_REFEREE' : 'POSITIONS_UNFILLED';
      const cancelled = await this.cancelInTx(tx, matchId, reason);
      return {
        outcome: 'CANCELLED' as const,
        notifications: cancelled.notifications,
        filled,
        total,
        refereeReady,
        reason,
      };
    });
  }

  /**
   * TKT-319 "not full yet" reminder, run by the durable QUICK_MATCH_FILL_REMINDER job 2 hours before
   * kickoff. Under the same Match row lock as the go/no-go decision. A no-op for legacy, cancelled,
   * already-confirmed or full matches; otherwise one notification per host and joined player, with
   * a stable dedupe key so a second run creates nothing new.
   */
  sendFillReminder(matchId: string) {
    return serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: {
          status: true,
          startsAt: true,
          goNoGoAt: true,
          confirmedAt: true,
          createdById: true,
          hostedByFootyFinder: true,
          otherSideMode: true,
          otherSideTakenBy: true,
          formationSlots: { select: { participantId: true, team: true } },
          participants: { where: { status: 'JOINED' }, select: { userId: true } },
          teamSides: { where: { side: 'HOME' }, select: { team: { select: { memberships: { select: { userId: true } } } } } },
        },
      });
      const none = { notifications: [] as Notification[], open: 0 };
      if (!match) return none;
      // Gate 7 / decision E: for an "Open to both" team match, remind about the individuals side
      // (the home team manages its own lineup). "Teams only" and team-taken sides get no reminder.
      const teamMatch = Boolean(match.otherSideMode);
      if (teamMatch && (match.otherSideMode !== 'OPEN' || match.otherSideTakenBy === 'TEAM')) return none;
      const open = openPositionsForReminder({
        ...match,
        formationSlots: teamMatch ? match.formationSlots.filter(({ team }) => team === 'AWAY') : match.formationSlots,
      });
      if (open === 0) return none;
      const homeMembers = match.teamSides[0]?.team?.memberships.map(({ userId }) => userId) ?? [];
      const recipients = [
        ...new Set([...match.participants.map(({ userId }) => userId), ...homeMembers, ...hostAudience(match)]),
      ];
      const notifications = await persistNotifications(
        tx,
        recipients.map((userId) => ({
          userId,
          type: 'MATCH_FILL_REMINDER' as const,
          title: 'Positions still open',
          message: fillReminderMessage(open, match.startsAt),
          targetPath: `/matches/${matchId}`,
          dedupeKey: notificationDedupeKey('match', matchId, 'fill-reminder', userId),
        })),
      );
      return { notifications, open };
    });
  }

  /**
   * Shared cancellation core for organiser cancellation, the T-30 auto-cancel and (Gate 7) every
   * team-match cancellation. DEC-021 A3: every paid ticket's payer chooses a match credit or a full refund (refunded
   * automatically after 7 days); credit-paid tickets get their credit back; free places owe nothing. Nothing is owed
   * to the venue. Members of attached teams are notified too.
   */
  async cancelInTx(
    tx: Prisma.TransactionClient,
    matchId: string,
    reason: MatchCancellationReason,
  ) {
    await lockMatchForFormation(tx, matchId);
    const match = await tx.match.findUniqueOrThrow({
      where: { id: matchId },
      include: {
        fieldReservation: true,
        venue: { select: { name: true } },
        participants: { where: { status: 'JOINED' }, select: { userId: true } },
      },
    });
    if (match.status === 'CANCELLED')
      return { match, payerIds: [] as string[], notifications: [] as Notification[] };
    const memberships = await tx.teamMembership.findMany({
      where: { team: { matchSides: { some: { matchId } } } },
      select: { userId: true },
    });
    const teamMemberIds = new Set(memberships.map(({ userId }) => userId));
    // CEO touch-up batch 3, item 5: free-match players paid nothing; FootyFinder's promotional cover is reversed.
    await reversePromotionalCosts(tx, { matchId }, `MATCH_CANCELLED:${reason}`, new Date());
    // DEC-021 A3: every ticket holder (the payer) chooses a match credit or a full refund; credit-paid tickets get
    // their credit back; free places owe nothing.
    const tickets = await settleTicketsOnCancellationInTx(tx, matchId, new Date());
    // One alert per person: every joined player, every ticket payer, the teams' members and the host. Each gets
    // one in-app notification (realtime toast after commit) and one transactional email job.
    const recipients = [
      ...new Set([
        ...match.participants.map(({ userId }) => userId),
        ...tickets.byPayer.keys(),
        ...teamMemberIds,
        ...hostAudience(match),
      ]),
    ];
    const notificationDrafts: NotificationDraft[] = [];
    for (const userId of recipients) {
      const ticketFacts = tickets.byPayer.get(userId);
      notificationDrafts.push({
        userId,
        type: ticketFacts?.choiceSeats ? 'TICKET_CHOICE_REQUIRED' : 'MATCH_CANCELLED',
        title: ticketFacts?.choiceSeats ? 'Match cancelled: choose a credit or a refund' : 'Match cancelled',
        message: matchCancelledMessage({
          venueName: match.venue.name,
          startsAt: match.startsAt,
          reason,
          ...ticketFacts,
        }),
        targetPath: `/matches/${matchId}`,
        dedupeKey: notificationDedupeKey('match', matchId, 'match-cancelled', userId),
      });
      await enqueueMatchCancelledEmail(tx, { matchId, userId, ...ticketFacts });
    }
    if (match.fieldReservation && match.fieldReservation.status !== 'CANCELLED') {
      // DEC-018: nothing is owed to the venue for a cancelled match and the host is never charged.
      await tx.fieldReservation.update({
        where: { id: match.fieldReservation.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          organizerGuaranteeSettledAt: match.fieldReservation.organizerGuaranteeSettledAt ?? new Date(),
          playerFeesAppliedCents: 0,
        },
      });
    }
    const cancelled = await tx.match.update({
      where: { id: matchId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason },
    });
    const notifications = await persistNotifications(tx, notificationDrafts);
    return { match: cancelled, payerIds: [...tickets.byPayer.keys()], notifications };
  }

  changeTeam(
    matchId: string,
    participantId: string,
    actorUserId: string,
    actorIsHost: boolean,
    team: 'HOME' | 'AWAY',
  ) {
    return serializableTransaction(async (tx) => {
      const match = await tx.match.findUniqueOrThrow({
        where: { id: matchId },
        include: { participants: { where: { status: 'JOINED' } } },
      });
      if (match.mode === 'TEAM_MATCH') throw new TeamMatchPlanningError();
      assertLobbyOpen(match, new Date());
      const participant = match.participants.find((item) => item.id === participantId);
      if (!participant) throw new Error('PARTICIPANT_NOT_FOUND');
      if (!actorIsHost && participant.userId !== actorUserId) throw new Error('PLAYER_FORBIDDEN');
      if (participant.team === team)
        return tx.matchParticipant.findUniqueOrThrow({
          where: { id: participantId },
          include: participantInclude,
        });
      const slot = await tx.formationSlot.findUnique({ where: { participantId } });
      if (slot && !actorIsHost) throw new Error('ON_FIELD_SWITCH');
      if (
        match.participants.filter((item) => item.team === team).length >=
        getMaxParticipantsPerTeam(match.format, match.substituteCapacityPerTeam)
      )
        throw new TeamFullError();
      if (slot) {
        await tx.formationSlot.update({ where: { id: slot.id }, data: { participantId: null } });
        await bumpFormationVersion(tx, matchId);
      }
      return tx.matchParticipant.update({
        where: { id: participantId },
        data: { team },
        include: participantInclude,
      });
    });
  }

  async updateFormation(
    matchId: string,
    slotId: string,
    input: FormationSlotUpdateInput,
    actorUserId: string,
  ) {
    return serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const target = await tx.formationSlot.findFirstOrThrow({ where: { id: slotId, matchId } });
      const participantChanges: Array<{
        action: 'ORGANISER_ASSIGN' | 'ORGANISER_SWAP' | 'ORGANISER_REMOVE';
        participantId: string | null;
        previousParticipantId: string | null;
        affectedParticipantIds: string[];
      }> = [];
      let changed = false;
      if (input.participantId !== undefined) {
        if (input.participantId === null) {
          if (target.participantId) {
            await tx.formationSlot.update({ where: { id: slotId }, data: { participantId: null } });
            participantChanges.push({
              action: 'ORGANISER_REMOVE',
              participantId: null,
              previousParticipantId: target.participantId,
              affectedParticipantIds: [target.participantId],
            });
            changed = true;
          }
        } else if (target.participantId !== input.participantId) {
          const participant = await tx.matchParticipant.findFirstOrThrow({
            where: { id: input.participantId, matchId, status: 'JOINED', team: target.team },
          });
          const source = await tx.formationSlot.findUnique({
            where: { participantId: participant.id },
          });
          const targetParticipantId = target.participantId;
          if (source)
            await tx.formationSlot.update({
              where: { id: source.id },
              data: { participantId: null },
            });
          if (targetParticipantId)
            await tx.formationSlot.update({
              where: { id: target.id },
              data: { participantId: null },
            });
          await tx.formationSlot.update({
            where: { id: target.id },
            data: { participantId: participant.id },
          });
          if (source && targetParticipantId)
            await tx.formationSlot.update({
              where: { id: source.id },
              data: { participantId: targetParticipantId },
            });
          participantChanges.push({
            action: source && targetParticipantId ? 'ORGANISER_SWAP' : 'ORGANISER_ASSIGN',
            participantId: participant.id,
            previousParticipantId: targetParticipantId,
            affectedParticipantIds: targetParticipantId
              ? [participant.id, targetParticipantId]
              : [participant.id],
          });
          changed = true;
        }
      }
      if (input.positionX !== undefined || input.positionY !== undefined) {
        await tx.formationSlot.update({
          where: { id: slotId },
          data: { positionX: input.positionX, positionY: input.positionY },
        });
        changed = true;
      }
      let notifications: Notification[] = [];
      if (changed) {
        const formationVersion = await bumpFormationVersion(tx, matchId);
        const drafts: NotificationDraft[] = [];
        for (const change of participantChanges) {
          const event = await tx.matchFormationEvent.create({
            data: {
              matchId,
              slotId,
              actorUserId,
              action: change.action,
              participantId: change.participantId,
              previousParticipantId: change.previousParticipantId,
              formationVersion,
            },
          });
          const affected = await tx.matchParticipant.findMany({
            where: { id: { in: change.affectedParticipantIds } },
            select: { userId: true },
          });
          for (const { userId } of affected)
            if (userId !== actorUserId)
              drafts.push({
                userId,
                type: 'MATCH_POSITION_CHANGED',
                title: 'Your position changed',
                message:
                  change.action === 'ORGANISER_REMOVE'
                    ? 'The organiser moved you to the reserves.'
                    : 'The organiser changed your position on the pitch.',
                targetPath: `/matches/${matchId}`,
                dedupeKey: notificationDedupeKey('match-formation-event', event.id, userId),
              });
        }
        notifications = await persistNotifications(tx, drafts);
      }
      return {
        match: await tx.match.findUniqueOrThrow({ where: { id: matchId }, include: matchInclude }),
        notifications,
        changed,
      };
    });
  }

  /**
   * Quick Match self-claim (DEC-013). Every eligibility check and the write run in one
   * serializable transaction behind a Match row lock, so the first committed claim wins and a
   * concurrent loser re-reads an occupied slot on retry.
   */
  async claimPosition(matchId: string, slotId: string, userId: string, nowOverride?: Date) {
    return serializableTransaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: { mode: true, status: true, startsAt: true, durationMinutes: true, goNoGoAt: true, otherSideMode: true },
      });
      if (!match) throw new FormationSlotNotFoundError();
      if (match.mode === 'TEAM_MATCH' && !match.otherSideMode) throw new TeamMatchPlanningError();
      await lockMatchForFormation(tx, matchId);
      // Evaluate time only after the Match row lock, so a claim racing the go/no-go job at T-30 is
      // judged against the same instant the job sees.
      const now = nowOverride ?? new Date();
      const locked = await tx.match.findUniqueOrThrow({
        where: { id: matchId },
        select: { mode: true, status: true, startsAt: true, durationMinutes: true, goNoGoAt: true, otherSideMode: true },
      });
      assertLobbyOpen(locked, now);
      const participant = await tx.matchParticipant.findUnique({
        where: { matchId_userId: { matchId, userId } },
        include: { formationSlot: true },
      });
      if (!participant || participant.status !== 'JOINED') throw new NotMatchParticipantError();
      const target = await tx.formationSlot.findFirst({ where: { id: slotId, matchId } });
      if (!target) throw new FormationSlotNotFoundError();
      if (target.team !== participant.team) throw new PositionWrongSideError();
      if (target.participantId === participant.id)
        return {
          match: await tx.match.findUniqueOrThrow({ where: { id: matchId }, include: matchInclude }),
          replayed: true,
        };
      if (target.participantId) throw new PositionAlreadyClaimedError();
      // DEC-021 A1.2: someone else is paying for this position right now ("Being booked").
      if (await tx.matchTicket.count({ where: { slotId: target.id, status: 'HELD', holdExpiresAt: { gt: now }, playerId: { not: userId } } }))
        throw new PositionBeingBookedError();
      const source = participant.formationSlot;
      if (source)
        await tx.formationSlot.update({ where: { id: source.id }, data: { participantId: null } });
      const claimed = await tx.formationSlot.updateMany({
        where: { id: target.id, participantId: null },
        data: { participantId: participant.id },
      });
      if (claimed.count !== 1) throw new PositionAlreadyClaimedError();
      const formationVersion = await bumpFormationVersion(tx, matchId);
      await tx.matchFormationEvent.create({
        data: {
          matchId,
          slotId: target.id,
          actorUserId: userId,
          action: source ? 'SELF_MOVE' : 'SELF_CLAIM',
          participantId: participant.id,
          previousParticipantId: null,
          formationVersion,
        },
      });
      return {
        match: await tx.match.findUniqueOrThrow({ where: { id: matchId }, include: matchInclude }),
        replayed: false,
      };
    });
  }

  submitResult(matchId: string, userId: string, input: ResultInput) {
    return serializableTransaction(async (tx) => {
      const match = await tx.match.findUniqueOrThrow({
        where: { id: matchId },
        select: { name: true, createdById: true, hostedByFootyFinder: true },
      });
      const participants = await tx.matchParticipant.findMany({ where: { matchId } });
      const participantMap = new Map(
        participants.map((participant) => [participant.id, participant]),
      );
      const scorerRows = input.scorers.map((scorer) => {
        const participant = participantMap.get(scorer.participantId);
        if (!participant) throw new Error('INVALID_SCORER');
        return { ...scorer, team: participant.team };
      });
      const homeGoals = scorerRows
        .filter(({ team }) => team === 'HOME')
        .reduce((sum, scorer) => sum + scorer.goals, 0);
      const awayGoals = scorerRows
        .filter(({ team }) => team === 'AWAY')
        .reduce((sum, scorer) => sum + scorer.goals, 0);
      if (homeGoals !== input.homeScore || awayGoals !== input.awayScore)
        throw new Error('SCORER_TOTAL_MISMATCH');
      const result = await tx.matchResult.create({
        data: {
          matchId,
          submittedById: userId,
          homeScore: input.homeScore,
          awayScore: input.awayScore,
          scorers: {
            create: scorerRows.map((scorer) => ({
              participantId: scorer.participantId,
              team: scorer.team,
              goals: scorer.goals,
            })),
          },
        },
      });
      await tx.matchResultRevision.create({
        data: {
          matchResultId: result.id,
          revisionNumber: 1,
          homeScore: input.homeScore,
          awayScore: input.awayScore,
          scorersSnapshot: scorerRows.map(({ participantId, team, goals }) => ({ participantId, team, goals })),
          reason: 'INITIAL_SUBMISSION',
        },
      });
      await tx.match.update({ where: { id: matchId }, data: { status: 'COMPLETED' } });
      const recipients = new Set([...hostAudience(match), ...participants.map(({ userId }) => userId)]);
      const notifications = await persistNotifications(
        tx,
        [...recipients].map((recipientId) => ({
          userId: recipientId,
          type: 'RESULT_SUBMITTED' as const,
          title: 'Result submitted',
          message: `Final score: Home ${input.homeScore}-${input.awayScore} Away.`,
          targetPath: `/matches/${matchId}`,
          dedupeKey: notificationDedupeKey('match-result', result.id, 'submitted', recipientId),
        })),
      );
      return {
        match: await tx.match.findUniqueOrThrow({ where: { id: matchId }, include: matchInclude }),
        notifications,
      };
    });
  }
}
