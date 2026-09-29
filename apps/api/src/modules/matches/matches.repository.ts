import { randomUUID } from 'node:crypto';
import type {
  CreateTeamMatchInput,
  DiscoveryQuery,
  FormationSlotUpdateInput,
  JoinMatchInput,
  ResultInput,
  UpdateMatchInput,
} from '@footy-finder/shared';
import {
  CANCELLATION_CUTOFF_HOURS,
  createDefaultFormation,
  createFormationPresetSlots,
  getCancellationCreditCents,
  getMaxParticipantsPerTeam,
  isLobbyFrozen,
  mapTeamPositionToMatchHalf,
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
import {
  FinancialInsufficientFundsError,
  FinancialRepository,
} from '../wallet/financial.repository.js';

export class InsufficientBalanceError extends Error {}
export class AlreadyJoinedError extends Error {}
export class TeamFullError extends Error {}
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

/**
 * Takes the Match row lock that every formation mutation shares, so claims and organiser moves
 * on one Match serialize in a consistent lock order (Match, then slots).
 */
const lockMatchForFormation = (tx: Prisma.TransactionClient, matchId: string) =>
  tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId}::uuid FOR UPDATE`;

const bumpFormationVersion = async (tx: Prisma.TransactionClient, matchId: string) =>
  (
    await tx.match.update({
      where: { id: matchId },
      data: { formationVersion: { increment: 1 } },
      select: { formationVersion: true },
    })
  ).formationVersion;

const isLobbyOpen = (
  match: { mode: string; status: string; startsAt: Date; durationMinutes: number },
  now: Date,
) =>
  match.mode === 'QUICK_GAME' &&
  ['OPEN', 'READY'].includes(match.status) &&
  now < match.startsAt;

/**
 * Throws LineupLockedError once a DEC-018 match reaches its go/no-go instant (distinct from a
 * started/closed match), or MatchClosedError when the lobby is otherwise closed.
 */
const assertLobbyOpen = (
  match: { mode: string; status: string; startsAt: Date; durationMinutes: number; goNoGoAt?: Date | null },
  now: Date,
) => {
  if (isLobbyOpen(match, now) && isLobbyFrozen(match, now)) throw new LineupLockedError();
  if (!isLobbyOpen(match, now)) throw new MatchClosedError();
};

export class MatchesRepository {
  constructor(private readonly financial = new FinancialRepository()) {}
  listPublic(query: DiscoveryQuery) {
    return prisma.match.findMany({
      where: {
        mode: 'QUICK_GAME',
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
    return prisma.match.findFirst({
      where: { publicSlug, visibility: 'PUBLIC' },
      select: {
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
        venue: { select: { name: true, city: true, region: true } },
        participants: { where: { status: 'JOINED' }, select: { id: true } },
        goNoGoAt: true,
        confirmedAt: true,
        cancellationReason: true,
        formationSlots: { select: { participantId: true } },
      },
    });
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
  findCancellation(matchId: string, userId: string) {
    return prisma.participantCancellation.findFirst({ where: { matchId, userId } });
  }
  findAttachedTeamMembership(matchId: string, userId: string) {
    return prisma.teamMembership.findFirst({
      where: { userId, team: { matchSides: { some: { matchId } } } },
      select: { teamId: true, role: true },
    });
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
      const matchTeam = match.teamSides[0]!;
      const teamFormation = team.formations[0];
      const presetSlots = createFormationPresetSlots(input.format, input.formationKey);
      const coordinateSlots =
        teamFormation?.formationKey === input.formationKey &&
        teamFormation.slots.length === presetSlots.length
          ? teamFormation.slots.map(({ slotIndex, positionX, positionY }) => ({
              slotIndex,
              positionX: Number(positionX),
              positionY: Number(positionY),
            }))
          : presetSlots;
      const validSlotIndexes = new Set(coordinateSlots.map(({ slotIndex }) => slotIndex));
      const assignedUserBySlot = new Map(
        teamFormation?.slots
          .filter(
            ({ membership, slotIndex }) => Boolean(membership) && validSlotIndexes.has(slotIndex),
          )
          .map(({ slotIndex, membership }) => [slotIndex, membership!.userId]) ?? [],
      );
      const selectionIdByUser = new Map<string, string>();
      for (const assignedUserId of assignedUserBySlot.values())
        if (!selectionIdByUser.has(assignedUserId))
          selectionIdByUser.set(assignedUserId, randomUUID());
      if (selectionIdByUser.size)
        await tx.teamMatchSelection.createMany({
          data: [...selectionIdByUser].map(([selectedUserId, id]) => ({
            id,
            matchTeamId: matchTeam.id,
            userId: selectedUserId,
            status: 'SELECTED_STARTER',
            selectedByUserId: userId,
          })),
        });
      await tx.teamMatchLineupSlot.createMany({
        data: coordinateSlots.map((slot) => {
          const assignedUserId = assignedUserBySlot.get(slot.slotIndex);
          return {
            matchTeamId: matchTeam.id,
            slotIndex: slot.slotIndex,
            ...mapTeamPositionToMatchHalf('HOME', slot),
            selectionId: assignedUserId ? selectionIdByUser.get(assignedUserId) : undefined,
          };
        }),
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

  join(matchId: string, userId: string, input: JoinMatchInput, idempotencyKey: string) {
    return serializableTransaction(async (tx) => {
      const replay = await tx.matchPayment.findUnique({
        where: { idempotencyKey },
        include: { participant: { include: participantInclude } },
      });
      if (replay) {
        if (replay.matchId !== matchId || replay.userId !== userId || replay.team !== input.team)
          throw new AlreadyJoinedError();
        return {
          participant: replay.participant,
          replacement: null,
          replayed: true,
          notifications: [],
        };
      }
      const match = await tx.match.findUniqueOrThrow({
        where: { id: matchId },
        include: { participants: { where: { status: 'JOINED' } } },
      });
      if (match.mode === 'TEAM_MATCH') throw new TeamMatchPlanningError();
      assertLobbyOpen(match, new Date());
      const previousParticipation = await tx.matchParticipant.findUnique({
        where: { matchId_userId: { matchId, userId } },
        include: { payment: true },
      });
      // A player cannot buy a second place after leaving. This check runs before
      // the wallet debit so a historical payment can never surface as a late
      // unique-constraint failure.
      if (previousParticipation?.payment) throw new AlreadyJoinedError();
      if (match.participants.some((participant) => participant.userId === userId))
        throw new AlreadyJoinedError();
      if (
        match.participants.filter((participant) => participant.team === input.team).length >=
        getMaxParticipantsPerTeam(match.format, match.substituteCapacityPerTeam)
      )
        throw new TeamFullError();

      let debit;
      try {
        debit = await this.financial.debit(tx, {
          userId,
          amountCents: match.feeCents,
          type: 'MATCH_ENTRY_DEBIT',
          idempotencyKey: `match-payment:${idempotencyKey}`,
          referenceType: 'MATCH',
          referenceId: matchId,
          description: `Entry fee for ${match.name}`,
        });
      } catch (error) {
        if (error instanceof FinancialInsufficientFundsError) throw new InsufficientBalanceError();
        throw error;
      }
      const participant = await tx.matchParticipant.upsert({
        where: { matchId_userId: { matchId, userId } },
        create: { matchId, userId, team: input.team },
        update: { status: 'JOINED', team: input.team, joinedAt: new Date(), leftAt: null },
        include: participantInclude,
      });
      const walletTransaction = debit.transaction;
      await tx.matchPayment.create({
        data: {
          matchId,
          userId,
          participantId: participant.id,
          team: input.team,
          amountCents: match.feeCents,
          walletTransactionId: walletTransaction.id,
          idempotencyKey,
        },
      });

      const cancellation = await tx.participantCancellation.findFirst({
        where: {
          matchId,
          originalTeam: input.team,
          replacementParticipantId: null,
          replacementCreditCents: 0,
          matchPayment: { status: { not: 'REFUNDED' } },
        },
        orderBy: { cancelledAt: 'asc' },
      });
      let replacement: { userId: string; amountCents: number } | null = null;
      if (cancellation && cancellation.initialCreditCents < cancellation.originalAmountCents) {
        const amountCents = cancellation.originalAmountCents - cancellation.initialCreditCents;
        await this.financial.credit(tx, {
          userId: cancellation.userId,
          amountCents,
          type: 'REPLACEMENT_CREDIT',
          idempotencyKey: `replacement-credit:${cancellation.id}`,
          referenceType: 'CANCELLATION',
          referenceId: cancellation.id,
          description: 'Remaining cancellation credit after replacement joined',
        });
        await tx.participantCancellation.update({
          where: { id: cancellation.id },
          data: { replacementParticipantId: participant.id, replacementCreditCents: amountCents },
        });
        await tx.matchPayment.update({
          where: { id: cancellation.matchPaymentId },
          data: { status: 'REFUNDED' },
        });
        replacement = { userId: cancellation.userId, amountCents };
      }
      const notificationDrafts: NotificationDraft[] = [
        {
          userId,
          type: 'MATCH_JOINED',
          title: 'Match joined',
          message: `Your place on the ${input.team === 'HOME' ? 'Home' : 'Away'} team is confirmed.`,
          targetPath: `/matches/${matchId}`,
          dedupeKey: notificationDedupeKey(
            'match',
            matchId,
            'participant',
            participant.id,
            'joined',
            userId,
          ),
        },
      ];
      const audience = new Set([
        match.createdById,
        ...match.participants.map(({ userId: participantUserId }) => participantUserId),
      ]);
      audience.delete(userId);
      const displayName = participant.user.profile?.displayName ?? participant.user.username;
      for (const recipientId of audience)
        notificationDrafts.push({
          userId: recipientId,
          type: 'INFO',
          title: 'Player joined',
          message: `${displayName} joined the ${input.team === 'HOME' ? 'Home' : 'Away'} team.`,
          targetPath: `/matches/${matchId}`,
          dedupeKey: notificationDedupeKey(
            'match',
            matchId,
            'participant',
            participant.id,
            'joined-audience',
            recipientId,
          ),
        });
      if (replacement)
        notificationDrafts.push(
          {
            userId: replacement.userId,
            type: 'REPLACEMENT_FOUND',
            title: 'Replacement found',
            message: 'The remaining cancellation credit was added to your wallet.',
            targetPath: `/matches/${matchId}`,
            dedupeKey: notificationDedupeKey(
              'cancellation',
              cancellation!.id,
              'replacement-found',
              replacement.userId,
            ),
          },
          {
            userId: replacement.userId,
            type: 'WALLET_CREDIT',
            title: 'Wallet credited',
            message: `R${(replacement.amountCents / 100).toFixed(2)} was added to your balance.`,
            targetPath: `/matches/${matchId}`,
            dedupeKey: notificationDedupeKey(
              'cancellation',
              cancellation!.id,
              'wallet-credit',
              replacement.userId,
            ),
          },
        );
      const notifications = await persistNotifications(tx, notificationDrafts);
      return { participant, replacement, replayed: false, notifications };
    });
  }

  cancelParticipation(matchId: string, userId: string, now: Date) {
    return serializableTransaction(async (tx) => {
      const match = await tx.match.findUniqueOrThrow({ where: { id: matchId } });
      if (match.mode === 'TEAM_MATCH') throw new TeamMatchPlanningError();
      assertLobbyOpen(match, now);
      const participant = await tx.matchParticipant.findUniqueOrThrow({
        where: { matchId_userId: { matchId, userId } },
        include: { payment: { include: { cancellation: true } } },
      });
      if (participant.payment?.cancellation)
        return {
          cancellation: participant.payment.cancellation,
          replayed: true,
          notifications: [],
        };
      if (participant.status !== 'JOINED') throw new AlreadyJoinedError();
      const released = await tx.formationSlot.updateMany({
        where: { participantId: participant.id },
        data: { participantId: null },
      });
      if (released.count > 0) await bumpFormationVersion(tx, matchId);
      await tx.matchParticipant.update({
        where: { id: participant.id },
        data: { status: 'LEFT', leftAt: now },
      });
      if (!participant.payment) return { cancellation: null, replayed: false, notifications: [] };
      const initialCreditCents = getCancellationCreditCents(
        participant.payment.amountCents,
        match.startsAt,
        now,
      );
      if (initialCreditCents === null) throw new MatchClosedError();
      if (initialCreditCents > 0) {
        await this.financial.credit(tx, {
          userId,
          amountCents: initialCreditCents,
          type:
            initialCreditCents === participant.payment.amountCents
              ? 'PLAYER_CANCELLATION_FULL_CREDIT'
              : 'PLAYER_CANCELLATION_PARTIAL_CREDIT',
          idempotencyKey: `player-cancellation:${participant.payment.id}`,
          referenceType: 'MATCH_PAYMENT',
          referenceId: participant.payment.id,
          description: 'Player cancellation wallet credit',
        });
      }
      await tx.matchPayment.update({
        where: { id: participant.payment.id },
        data: {
          status:
            initialCreditCents === participant.payment.amountCents
              ? 'REFUNDED'
              : initialCreditCents > 0
                ? 'PARTIALLY_REFUNDED'
                : 'SUCCEEDED',
        },
      });
      const cancellation = await tx.participantCancellation.create({
        data: {
          matchId,
          userId,
          matchPaymentId: participant.payment.id,
          originalTeam: participant.team,
          originalAmountCents: participant.payment.amountCents,
          initialCreditCents,
        },
      });
      const notifications = await persistNotifications(tx, [
        {
          userId,
          type: 'PLAYER_CANCELLED',
          title: 'Place cancelled',
          message:
            cancellation.initialCreditCents > 0
              ? `R${(cancellation.initialCreditCents / 100).toFixed(2)} was credited to your wallet.`
              : `No credit is issued within ${CANCELLATION_CUTOFF_HOURS} hours of kickoff. Your fee will be credited if a replacement joins.`,
          targetPath: `/matches/${matchId}`,
          dedupeKey: notificationDedupeKey(
            'cancellation',
            cancellation.id,
            'player-cancelled',
            userId,
          ),
        },
      ]);
      return { cancellation, replayed: false, notifications };
    });
  }

  /** Organiser cancellation (D3: allowed until the go/no-go instant; enforced by the service). */
  cancelMatch(matchId: string) {
    return serializableTransaction((tx) => this.cancelInTx(tx, matchId, 'ORGANISER_CANCELLED'));
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
      if (total > 0 && filled === total) {
        await tx.match.update({ where: { id: matchId }, data: { confirmedAt: now } });
        const recipients = [
          ...new Set([...match.participants.map(({ userId }) => userId), match.createdById]),
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
        return { outcome: 'CONFIRMED' as const, notifications, filled, total };
      }
      const cancelled = await this.cancelInTx(tx, matchId, 'POSITIONS_UNFILLED');
      return {
        outcome: 'CANCELLED' as const,
        notifications: cancelled.notifications,
        filled,
        total,
      };
    });
  }

  /**
   * Shared cancellation core for organiser cancellation and the T-30 auto-cancel. Every SUCCEEDED
   * payment gets a full MATCH_CANCELLATION_CREDIT with the stable key match-cancellation:<paymentId>,
   * so two cancellation paths can never refund the same fee twice. Nothing is owed to the venue.
   */
  private async cancelInTx(
    tx: Prisma.TransactionClient,
    matchId: string,
    reason: 'ORGANISER_CANCELLED' | 'POSITIONS_UNFILLED',
  ) {
    await lockMatchForFormation(tx, matchId);
    const match = await tx.match.findUniqueOrThrow({
      where: { id: matchId },
      include: {
        payments: { where: { status: 'SUCCEEDED' } },
        fieldReservation: true,
        venue: { select: { name: true } },
        participants: { where: { status: 'JOINED' }, select: { userId: true } },
      },
    });
    if (match.status === 'CANCELLED')
      return { match, refundedUserIds: [] as string[], notifications: [] as Notification[] };
    const unfilled = reason === 'POSITIONS_UNFILLED';
    const refundedUserIds: string[] = [];
    const refundedCentsByUser = new Map<string, number>();
    for (const payment of match.payments) {
      await this.financial.credit(tx, {
        userId: payment.userId,
        amountCents: payment.amountCents,
        type: 'MATCH_CANCELLATION_CREDIT',
        idempotencyKey: `match-cancellation:${payment.id}`,
        referenceType: 'MATCH_PAYMENT',
        referenceId: payment.id,
        description: unfilled
          ? 'Full refund: not all positions were filled 30 minutes before kickoff'
          : 'Full credit for cancelled match',
      });
      await tx.matchPayment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
      refundedUserIds.push(payment.userId);
      refundedCentsByUser.set(
        payment.userId,
        (refundedCentsByUser.get(payment.userId) ?? 0) + payment.amountCents,
      );
    }
    // One alert per person: every joined player, every refunded payer and the host. Each gets one
    // in-app notification (realtime toast after commit) and one transactional email job.
    const recipients = [
      ...new Set([
        ...match.participants.map(({ userId }) => userId),
        ...refundedCentsByUser.keys(),
        match.createdById,
      ]),
    ];
    const notificationDrafts: NotificationDraft[] = [];
    for (const userId of recipients) {
      const refundedCents = refundedCentsByUser.get(userId) ?? 0;
      notificationDrafts.push({
        userId,
        type: 'MATCH_CANCELLED',
        title: 'Match cancelled',
        message: matchCancelledMessage({
          venueName: match.venue.name,
          startsAt: match.startsAt,
          reason,
          refundedCents,
        }),
        targetPath: `/matches/${matchId}`,
        dedupeKey: notificationDedupeKey('match', matchId, 'match-cancelled', userId),
      });
      await enqueueMatchCancelledEmail(tx, { matchId, userId, refundedCents });
    }
    if (match.fieldReservation && match.fieldReservation.status !== 'CANCELLED') {
      // DEC-018: nothing is owed to the venue for a cancelled match and the host is never
      // charged. A legacy (pre-DEC-018) organiser hold is simply released.
      if (
        match.fieldReservation.organizerGuaranteeHoldId &&
        !match.fieldReservation.organizerGuaranteeSettledAt
      )
        await this.financial.releaseHold(tx, match.fieldReservation.organizerGuaranteeHoldId);
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
    return { match: cancelled, refundedUserIds, notifications };
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
        select: { mode: true, status: true, startsAt: true, durationMinutes: true, goNoGoAt: true },
      });
      if (!match) throw new FormationSlotNotFoundError();
      if (match.mode === 'TEAM_MATCH') throw new TeamMatchPlanningError();
      await lockMatchForFormation(tx, matchId);
      // Evaluate time only after the Match row lock, so a claim racing the go/no-go job at T-30 is
      // judged against the same instant the job sees.
      const now = nowOverride ?? new Date();
      const locked = await tx.match.findUniqueOrThrow({
        where: { id: matchId },
        select: { mode: true, status: true, startsAt: true, durationMinutes: true, goNoGoAt: true },
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
        select: { name: true, createdById: true },
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
      const recipients = new Set([match.createdById, ...participants.map(({ userId }) => userId)]);
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
