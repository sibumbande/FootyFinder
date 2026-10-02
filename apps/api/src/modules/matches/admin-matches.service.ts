import {
  adminMatchListQuerySchema,
  getMaxMatchParticipants,
  type AdminMatchDetail,
  type AdminMatchList,
  type AdminMatchListQuery,
  type AdminMatchMoney,
} from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { matchInviteUrl } from '../bookings/bookings.service.js';
import { RefereeAssignmentService } from '../referees/referee-assignment.service.js';
import { createMatchInviteToken, hashMatchInviteToken } from './invite-token.js';
import { publicMatchUrl } from './public-match.js';

const PAGE_SIZE = 50;
const HOUR = 3_600_000;
/** The start of a South African calendar day (UTC+2, no daylight saving). */
const saDayStart = (day: string) => new Date(`${day}T00:00:00.000+02:00`);
const nameOf = (user: { username: string; profile: { displayName: string } | null }) => user.profile?.displayName ?? user.username;
const hostName = (match: { hostedByFootyFinder: boolean; createdBy: { username: string; profile: { displayName: string } | null } }) =>
  match.hostedByFootyFinder ? 'FootyFinder' : nameOf(match.createdBy);
const userSelect = { select: { username: true, profile: { select: { displayName: true } } } } as const;
const open = ['DRAFT', 'OPEN', 'READY', 'IN_PROGRESS', 'AWAITING_RESULT'] as const;

/**
 * CEO touch-up batch 3.5, item 5: the admin Matches section. One searchable list (upcoming, live, finished,
 * cancelled; venue; dates; quick filters for the work queues) and one page per match with everything an admin
 * can do to it. The actions themselves keep their existing routes and rules (fresh MFA where it already applied).
 */
export class AdminMatchesService {
  constructor(private readonly referees = new RefereeAssignmentService()) {}

  async list(query: AdminMatchListQuery, now = new Date()): Promise<AdminMatchList> {
    const { view, needs, venueId, q, from, to, page } = adminMatchListQuerySchema.parse(query);
    const where: Prisma.MatchWhereInput = {
      ...(needs === 'referee'
        ? { refereeUserId: null, goNoGoAt: { not: null }, status: { in: [...open] }, startsAt: { gt: now } }
        : needs === 'result'
          ? { goNoGoAt: { not: null }, status: { in: ['OPEN', 'READY', 'IN_PROGRESS', 'AWAITING_RESULT'] }, result: null, startsAt: { lte: new Date(now.getTime() - HOUR) } }
          : needs === 'problem'
            ? { resultProblemReports: { some: { status: 'OPEN' } } }
            : view === 'upcoming'
              ? { status: { in: [...open] }, startsAt: { gt: now } }
              : view === 'live'
                ? { status: { in: [...open] }, startsAt: { lte: now } }
                : { status: view === 'finished' ? 'COMPLETED' : 'CANCELLED' }),
      ...(venueId && { fieldReservation: { field: { venueId } } }),
      ...(q && { name: { contains: q, mode: 'insensitive' } }),
    };
    const range: Prisma.DateTimeFilter = {
      ...(from && { gte: saDayStart(from) }),
      ...(to && { lt: new Date(saDayStart(to).getTime() + 24 * HOUR) }),
    };
    if (from || to) where.AND = [{ startsAt: range }];
    const ascending = needs === 'referee' || (!needs && (view === 'upcoming' || view === 'live'));
    const [total, rows] = await Promise.all([
      prisma.match.count({ where }),
      prisma.match.findMany({
        where,
        orderBy: { startsAt: ascending ? 'asc' : 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true, name: true, mode: true, format: true, status: true, startsAt: true, visibility: true, substituteCapacityPerTeam: true,
          freeOnFootyFinder: true, firstTimersOnly: true, hostedByFootyFinder: true, girlsOnly: true,
          venue: { select: { name: true } },
          createdBy: userSelect,
          referee: userSelect,
          _count: { select: { participants: { where: { status: 'JOINED' } } } },
        },
      }),
    ]);
    return {
      matches: rows.map((row) => ({
        matchId: row.id,
        name: row.name,
        mode: row.mode,
        format: row.format,
        status: row.status,
        startsAt: row.startsAt.toISOString(),
        venueName: row.venue.name,
        visibility: row.visibility,
        filled: row._count.participants,
        capacity: getMaxMatchParticipants(row.format, row.substituteCapacityPerTeam),
        refereeName: row.referee ? nameOf(row.referee) : null,
        freeOnFootyFinder: row.freeOnFootyFinder,
        firstTimersOnly: row.firstTimersOnly,
        hostedByFootyFinder: row.hostedByFootyFinder,
        girlsOnly: row.girlsOnly,
        hostName: hostName(row),
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  async detail(matchId: string, now = new Date()): Promise<AdminMatchDetail> {
    const base = await this.referees.getMatch(matchId);
    const match = await prisma.match.findUniqueOrThrow({
      where: { id: matchId },
      select: {
        visibility: true, publicSlug: true, hostedByFootyFinder: true, girlsOnly: true, mode: true, format: true, status: true, startsAt: true,
        goNoGoAt: true, substituteCapacityPerTeam: true, otherSideMode: true,
        createdBy: userSelect,
        fieldReservation: { select: { priceCentsSnapshot: true, status: true, fieldNameSnapshot: true } },
        venuePayable: { select: { amountCents: true, status: true } },
        promotionalCosts: { where: { status: 'ACTIVE' }, select: { amountCents: true } },
        participants: {
          orderBy: { joinedAt: 'asc' },
          select: {
            userId: true, team: true, status: true, joinedAt: true, leftAt: true,
            user: userSelect,
            formationSlot: { select: { slotIndex: true } },
            payment: { select: { amountCents: true, status: true, cancellation: { select: { initialCreditCents: true, replacementCreditCents: true } } } },
          },
        },
      },
    });
    const refunded = (payment: (typeof match.participants)[number]['payment']) =>
      !payment ? 0
        : payment.status === 'REFUNDED' ? payment.amountCents
          : payment.status === 'PARTIALLY_REFUNDED' ? (payment.cancellation?.initialCreditCents ?? 0) + (payment.cancellation?.replacementCreditCents ?? 0)
            : 0;
    const players = match.participants.map((participant) => ({
      userId: participant.userId,
      displayName: nameOf(participant.user),
      side: participant.team,
      position: participant.status !== 'JOINED' ? null : participant.formationSlot ? `Starting (position ${participant.formationSlot.slotIndex + 1})` : 'Substitute',
      status: participant.status,
      joinedAt: participant.joinedAt.toISOString(),
      leftAt: participant.leftAt?.toISOString() ?? null,
      paidCents: participant.payment?.amountCents ?? 0,
      refundedCents: refunded(participant.payment),
    }));
    const cancelled = match.status === 'CANCELLED';
    const money: AdminMatchMoney = {
      feesTakenCents: players.reduce((sum, player) => sum + player.paidCents, 0),
      refundedCents: players.reduce((sum, player) => sum + player.refundedCents, 0),
      promotionalCostCents: match.promotionalCosts.reduce((sum, cost) => sum + cost.amountCents, 0),
      teamMatch: match.mode === 'TEAM_MATCH',
      venue: match.venuePayable
        ? { kind: 'PAYABLE', amountCents: match.venuePayable.amountCents, payableStatus: match.venuePayable.status }
        : match.fieldReservation && !cancelled && match.fieldReservation.status === 'CONFIRMED'
          ? { kind: 'EXPECTED', amountCents: match.fieldReservation.priceCentsSnapshot }
          : { kind: 'NONE', amountCents: 0 },
    };
    const beforeKickoff = now < match.startsAt;
    const teamFeesTaken = match.mode === 'TEAM_MATCH' && match.goNoGoAt !== null && now >= match.goNoGoAt;
    return {
      ...base,
      visibility: match.visibility,
      hostedByFootyFinder: match.hostedByFootyFinder,
      girlsOnly: match.girlsOnly,
      hostName: hostName(match),
      fieldName: match.fieldReservation?.fieldNameSnapshot ?? null,
      publicUrl: match.publicSlug ? publicMatchUrl(match.publicSlug) : null,
      capacity: { filled: players.filter((player) => player.status === 'JOINED').length, total: getMaxMatchParticipants(match.format, match.substituteCapacityPerTeam) },
      players,
      money,
      started: !cancelled && !beforeKickoff,
      cancellable: !cancelled && match.status !== 'COMPLETED' && beforeKickoff && !teamFeesTaken,
    };
  }

  /** A new invite link for a private match FootyFinder hosts (the old link stops working). Audited. */
  async rotateInvite(matchId: string, actorUserId: string, requestId?: string) {
    const token = createMatchInviteToken();
    await serializableTransaction(async (tx) => {
      const match = await tx.match.findUnique({ where: { id: matchId }, select: { visibility: true, mode: true, hostedByFootyFinder: true, status: true } });
      if (!match) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
      if (match.visibility !== 'PRIVATE' || match.mode !== 'QUICK_GAME' || !match.hostedByFootyFinder)
        throw new AppError(409, 'Only private matches hosted by FootyFinder get an invite link here.', 'INVITE_NOT_AVAILABLE');
      if (['CANCELLED', 'COMPLETED'].includes(match.status)) throw new AppError(409, 'This match is over.', 'MATCH_CLOSED');
      await tx.match.update({ where: { id: matchId }, data: { inviteTokenHash: hashMatchInviteToken(token) } });
      await appendAdminAudit(tx, { actorUserId, action: 'MATCH_INVITE_ROTATED', entityType: 'MATCH', entityId: matchId, requestId });
    });
    return { inviteUrl: matchInviteUrl(token) };
  }
}
