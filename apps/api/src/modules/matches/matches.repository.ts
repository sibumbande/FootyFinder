import type { CreateMatchInput, SquadRole, TeamSide, UpdateMatchInput } from '@footy-finder/shared';
import { MATCH_CAPACITY } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';

export class InsufficientBalanceError extends Error {}
export class AlreadyJoinedError extends Error {}

const matchInclude = {
  createdBy: true,
  participants: {
    where: { status: 'JOINED' as const },
    include: { user: true },
    orderBy: { joinedAt: 'asc' as const },
  },
};

export class MatchesRepository {
  list() {
    return prisma.match.findMany({
      where: { status: { in: ['OPEN', 'FULL'] } },
      include: matchInclude,
      orderBy: { startsAt: 'asc' },
    });
  }

  findById(id: string) {
    return prisma.match.findUnique({ where: { id }, include: matchInclude });
  }

  createWithCharge(input: CreateMatchInput, userId: string, feeCents: number) {
    return prisma.$transaction(async (tx) => {
      const charged = await tx.user.updateMany({
        where: { id: userId, balanceCents: { gte: feeCents } },
        data: { balanceCents: { decrement: feeCents } },
      });
      if (charged.count !== 1) throw new InsufficientBalanceError();

      const match = await tx.match.create({
        data: {
          ...input,
          startsAt: new Date(input.startsAt),
          createdById: userId,
          maxPlayers: MATCH_CAPACITY,
          participants: {
            create: { userId, role: 'HOST', status: 'JOINED', team: 'HOME', squadRole: 'STARTER', slotNumber: 1 },
          },
        },
        include: matchInclude,
      });
      await tx.walletTransaction.create({
        data: {
          userId,
          type: 'MATCH_CREATE',
          amountCents: -feeCents,
          status: 'SUCCEEDED',
          matchId: match.id,
          idempotencyKey: `match-create:${match.id}`,
        },
      });
      return match;
    });
  }

  update(id: string, input: UpdateMatchInput) {
    return prisma.match.update({
      where: { id },
      data: { ...input, startsAt: input.startsAt ? new Date(input.startsAt) : undefined },
      include: matchInclude,
    });
  }

  remove(id: string) { return prisma.match.delete({ where: { id } }); }
  setStatus(id: string, status: 'OPEN' | 'FULL') { return prisma.match.update({ where: { id }, data: { status } }); }

  findParticipant(matchId: string, userId: string) {
    return prisma.matchParticipant.findUnique({ where: { matchId_userId: { matchId, userId } }, include: { user: true } });
  }

  joinWithCharge(matchId: string, userId: string, team: TeamSide, squadRole: SquadRole, slotNumber: number, feeCents: number, becomesFull: boolean) {
    return prisma.$transaction(async (tx) => {
      const charged = await tx.user.updateMany({
        where: { id: userId, balanceCents: { gte: feeCents } },
        data: { balanceCents: { decrement: feeCents } },
      });
      if (charged.count !== 1) throw new InsufficientBalanceError();

      const existing = await tx.matchParticipant.findUnique({ where: { matchId_userId: { matchId, userId } } });
      if (existing?.status === 'JOINED') throw new AlreadyJoinedError();

      const participant = await tx.matchParticipant.upsert({
        where: { matchId_userId: { matchId, userId } },
        create: { matchId, userId, team, squadRole, slotNumber, role: 'PLAYER', status: 'JOINED' },
        update: { team, squadRole, slotNumber, role: 'PLAYER', status: 'JOINED', joinedAt: new Date() },
        include: { user: true },
      });
      await tx.walletTransaction.create({
        data: {
          userId,
          type: 'MATCH_JOIN',
          amountCents: -feeCents,
          status: 'SUCCEEDED',
          matchId,
          idempotencyKey: `match-join:${participant.id}:${participant.joinedAt.toISOString()}`,
        },
      });
      if (becomesFull) await tx.match.update({ where: { id: matchId }, data: { status: 'FULL' } });
      return participant;
    });
  }

  leave(matchId: string, userId: string) {
    return prisma.matchParticipant.update({
      where: { matchId_userId: { matchId, userId } },
      data: { status: 'LEFT', team: null, squadRole: null, slotNumber: null },
    });
  }
}
