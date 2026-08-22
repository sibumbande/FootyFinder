import type {
  CreateMatchInput,
  CreateTeamMatchInput,
  DiscoveryQuery,
  FormationSlotUpdateInput,
  JoinMatchInput,
  MatchFormat,
  ResultInput,
  UpdateMatchInput,
} from '@footy-finder/shared';
import {
  createDefaultFormation,
  getCancellationCreditCents,
  getMaxParticipantsPerTeam,
} from '@footy-finder/shared';
import { serializableTransaction } from '../../database/transaction.js';
import { prisma } from '../../database/prisma.js';
import { matchInclude, participantInclude } from './match.query.js';

export class InsufficientBalanceError extends Error {}
export class AlreadyJoinedError extends Error {}
export class TeamFullError extends Error {}
export class MatchClosedError extends Error {}
export class TeamFixtureForbiddenError extends Error {}
export class TeamFixtureTeamNotFoundError extends Error {}
export class TeamMatchPlanningError extends Error {}

const isLobbyOpen = (
  match: { mode: string; status: string; startsAt: Date; durationMinutes: number },
  now: Date,
) =>
  match.mode === 'QUICK_GAME' &&
  ['OPEN', 'READY', 'FULL'].includes(match.status) &&
  now < match.startsAt;

export class MatchesRepository {
  listPublic(query: DiscoveryQuery) {
    return prisma.match.findMany({
      where: {
        mode: 'QUICK_GAME',
        visibility: 'PUBLIC',
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
        startsAt: {
          gte: query.dateFrom ? new Date(query.dateFrom) : new Date(),
          lte: query.dateTo ? new Date(query.dateTo) : undefined,
        },
        format: query.format,
        feeCents: query.maxPriceCents === undefined ? undefined : { lte: query.maxPriceCents },
      },
      include: matchInclude,
      orderBy:
        query.sort === 'lowest-price'
          ? [{ feeCents: 'asc' }, { startsAt: 'asc' }]
          : { startsAt: 'asc' },
      take: 200,
    });
  }
  findById(id: string) {
    return prisma.match.findUnique({ where: { id }, include: matchInclude });
  }
  findByInviteToken(inviteToken: string) {
    return prisma.match.findUnique({ where: { inviteToken }, include: matchInclude });
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
        },
      });
      if (!team) throw new TeamFixtureTeamNotFoundError();
      if (!team.memberships.some(({ role }) => role === 'OWNER' || role === 'CAPTAIN'))
        throw new TeamFixtureForbiddenError();
      return tx.match.create({
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
    });
  }

  create(input: CreateMatchInput, userId: string, durationMinutes: number, inviteToken?: string) {
    return serializableTransaction((tx) =>
      tx.match.create({
        data: {
          name: input.name,
          description: input.description,
          createdBy: { connect: { id: userId } },
          format: input.format,
          mode: 'QUICK_GAME',
          substituteCapacityPerTeam: input.substituteCapacityPerTeam,
          rollingSubstitutes: input.rollingSubstitutes,
          rules: input.rules,
          visibility: input.visibility,
          inviteToken,
          startsAt: new Date(input.startsAt),
          durationMinutes,
          feeCents: input.feeCents,
          currency: 'ZAR',
          venue: {
            create: {
              ...input.venue,
              latitude: input.venue.latitude,
              longitude: input.venue.longitude,
            },
          },
          formationSlots: { create: createDefaultFormation(input.format) },
        },
        include: matchInclude,
      }),
    );
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
        return { participant: replay.participant, replacement: null, replayed: true };
      }
      const match = await tx.match.findUniqueOrThrow({
        where: { id: matchId },
        include: { participants: { where: { status: 'JOINED' } } },
      });
      if (match.mode === 'TEAM_MATCH') throw new TeamMatchPlanningError();
      if (!isLobbyOpen(match, new Date())) throw new MatchClosedError();
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

      const wallet = await tx.walletAccount.findUniqueOrThrow({ where: { userId } });
      if (match.feeCents > 0) {
        const charged = await tx.walletAccount.updateMany({
          where: { id: wallet.id, balanceCents: { gte: match.feeCents } },
          data: { balanceCents: { decrement: match.feeCents } },
        });
        if (charged.count !== 1) throw new InsufficientBalanceError();
      }
      const participant = await tx.matchParticipant.upsert({
        where: { matchId_userId: { matchId, userId } },
        create: { matchId, userId, team: input.team },
        update: { status: 'JOINED', team: input.team, joinedAt: new Date(), leftAt: null },
        include: participantInclude,
      });
      const walletTransaction = await tx.walletTransaction.create({
        data: {
          walletAccountId: wallet.id,
          type: 'MATCH_ENTRY_DEBIT',
          amountCents: -match.feeCents,
          status: 'SUCCEEDED',
          idempotencyKey: `match-payment:${idempotencyKey}`,
          referenceType: 'MATCH',
          referenceId: matchId,
          description: `Entry fee for ${match.name}`,
        },
      });
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
        const cancelledWallet = await tx.walletAccount.findUniqueOrThrow({
          where: { userId: cancellation.userId },
        });
        await tx.walletAccount.update({
          where: { id: cancelledWallet.id },
          data: { balanceCents: { increment: amountCents } },
        });
        await tx.walletTransaction.create({
          data: {
            walletAccountId: cancelledWallet.id,
            type: 'REPLACEMENT_CREDIT',
            amountCents,
            status: 'SUCCEEDED',
            idempotencyKey: `replacement-credit:${cancellation.id}`,
            referenceType: 'CANCELLATION',
            referenceId: cancellation.id,
            description: 'Remaining cancellation credit after replacement joined',
          },
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
      return { participant, replacement, replayed: false };
    });
  }

  cancelParticipation(matchId: string, userId: string, now: Date) {
    return serializableTransaction(async (tx) => {
      const match = await tx.match.findUniqueOrThrow({ where: { id: matchId } });
      if (match.mode === 'TEAM_MATCH') throw new TeamMatchPlanningError();
      if (!isLobbyOpen(match, now)) throw new MatchClosedError();
      const participant = await tx.matchParticipant.findUniqueOrThrow({
        where: { matchId_userId: { matchId, userId } },
        include: { payment: { include: { cancellation: true } } },
      });
      if (participant.payment?.cancellation)
        return { cancellation: participant.payment.cancellation, replayed: true };
      if (participant.status !== 'JOINED') throw new AlreadyJoinedError();
      await tx.formationSlot.updateMany({
        where: { participantId: participant.id },
        data: { participantId: null },
      });
      await tx.matchParticipant.update({
        where: { id: participant.id },
        data: { status: 'LEFT', leftAt: now },
      });
      if (!participant.payment) return { cancellation: null, replayed: false };
      const initialCreditCents = getCancellationCreditCents(
        participant.payment.amountCents,
        match.startsAt,
        now,
      );
      if (initialCreditCents === null) throw new MatchClosedError();
      if (initialCreditCents > 0) {
        const wallet = await tx.walletAccount.findUniqueOrThrow({ where: { userId } });
        await tx.walletAccount.update({
          where: { id: wallet.id },
          data: { balanceCents: { increment: initialCreditCents } },
        });
        await tx.walletTransaction.create({
          data: {
            walletAccountId: wallet.id,
            type:
              initialCreditCents === participant.payment.amountCents
                ? 'PLAYER_CANCELLATION_FULL_CREDIT'
                : 'PLAYER_CANCELLATION_PARTIAL_CREDIT',
            amountCents: initialCreditCents,
            status: 'SUCCEEDED',
            idempotencyKey: `player-cancellation:${participant.payment.id}`,
            referenceType: 'MATCH_PAYMENT',
            referenceId: participant.payment.id,
            description: 'Player cancellation wallet credit',
          },
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
      return { cancellation, replayed: false };
    });
  }

  cancelMatch(matchId: string) {
    return serializableTransaction(async (tx) => {
      const match = await tx.match.findUniqueOrThrow({
        where: { id: matchId },
        include: { payments: { where: { status: 'SUCCEEDED' } } },
      });
      if (match.status === 'CANCELLED') return { match, refundedUserIds: [] as string[] };
      const refundedUserIds: string[] = [];
      for (const payment of match.payments) {
        const wallet = await tx.walletAccount.findUniqueOrThrow({
          where: { userId: payment.userId },
        });
        await tx.walletAccount.update({
          where: { id: wallet.id },
          data: { balanceCents: { increment: payment.amountCents } },
        });
        await tx.walletTransaction.create({
          data: {
            walletAccountId: wallet.id,
            type: 'MATCH_CANCELLATION_CREDIT',
            amountCents: payment.amountCents,
            status: 'SUCCEEDED',
            idempotencyKey: `match-cancellation:${payment.id}`,
            referenceType: 'MATCH_PAYMENT',
            referenceId: payment.id,
            description: 'Full credit for cancelled match',
          },
        });
        await tx.matchPayment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
        refundedUserIds.push(payment.userId);
      }
      return {
        match: await tx.match.update({
          where: { id: matchId },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        }),
        refundedUserIds,
      };
    });
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
      if (!isLobbyOpen(match, new Date())) throw new MatchClosedError();
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
      if (slot)
        await tx.formationSlot.update({ where: { id: slot.id }, data: { participantId: null } });
      return tx.matchParticipant.update({
        where: { id: participantId },
        data: { team },
        include: participantInclude,
      });
    });
  }

  async updateFormation(matchId: string, slotId: string, input: FormationSlotUpdateInput) {
    return serializableTransaction(async (tx) => {
      const target = await tx.formationSlot.findFirstOrThrow({ where: { id: slotId, matchId } });
      if (input.participantId !== undefined) {
        if (input.participantId === null)
          await tx.formationSlot.update({ where: { id: slotId }, data: { participantId: null } });
        else {
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
        }
      }
      if (input.positionX !== undefined || input.positionY !== undefined)
        await tx.formationSlot.update({
          where: { id: slotId },
          data: { positionX: input.positionX, positionY: input.positionY },
        });
      return tx.match.findUniqueOrThrow({ where: { id: matchId }, include: matchInclude });
    });
  }

  submitResult(matchId: string, userId: string, input: ResultInput) {
    return serializableTransaction(async (tx) => {
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
      await tx.matchResult.create({
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
      await tx.match.update({ where: { id: matchId }, data: { status: 'COMPLETED' } });
      return tx.match.findUniqueOrThrow({ where: { id: matchId }, include: matchInclude });
    });
  }
}

export const durationForFormat = (format: MatchFormat, values: Record<MatchFormat, number>) =>
  values[format];
