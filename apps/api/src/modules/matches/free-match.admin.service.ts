import { MATCH_FEE_CENTS, type AdminFreeMatchResult, type FreeMatchCostReport, type FreeMatchCostRow } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { appendAdminAudit } from '../admin/admin-audit.js';

/**
 * CEO touch-up batch 3, item 5: free "On FootyFinder" Quick Matches.
 * Marking (or unmarking) is allowed only before kickoff and while nobody has joined, so no player ever paid R80
 * for a match that became free (or joined free and then owed money). The match fee becomes R0; FootyFinder's
 * cover per player is recorded in its own promotions ledger when they join (D5).
 */
export class FreeMatchAdminService {
  async mark(matchId: string, input: { free: boolean; firstTimersOnly: boolean; reason: string }, actorUserId: string, requestId?: string, now = new Date()): Promise<AdminFreeMatchResult> {
    return serializableTransaction(async (tx) => {
      // Lock the match so a join cannot slip in between the "nobody has joined" check and the update.
      await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId}::uuid FOR UPDATE`;
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: { mode: true, otherSideMode: true, status: true, startsAt: true, freeOnFootyFinder: true, _count: { select: { participants: { where: { status: 'JOINED' } } } } },
      });
      if (!match) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
      if (match.mode !== 'QUICK_GAME' || match.otherSideMode) throw new AppError(409, 'Only Quick Matches can be free.', 'FREE_MATCH_QUICK_ONLY');
      if (!['DRAFT', 'OPEN', 'READY'].includes(match.status) || match.startsAt <= now)
        throw new AppError(409, 'This match can no longer be changed.', 'MATCH_CLOSED');
      if (match._count.participants > 0)
        throw new AppError(409, 'Players have already joined. A match can only be made free (or paid again) while nobody has joined.', 'FREE_MATCH_HAS_PLAYERS');
      const updated = await tx.match.update({
        where: { id: matchId },
        data: { freeOnFootyFinder: input.free, firstTimersOnly: input.free && input.firstTimersOnly, feeCents: input.free ? 0 : MATCH_FEE_CENTS },
        select: { id: true, freeOnFootyFinder: true, firstTimersOnly: true, feeCents: true },
      });
      await appendAdminAudit(tx, {
        actorUserId,
        action: input.free ? 'MATCH_MARKED_FREE' : 'MATCH_UNMARKED_FREE',
        entityType: 'MATCH',
        entityId: matchId,
        requestId,
        metadata: { reason: input.reason, firstTimersOnly: updated.firstTimersOnly },
      });
      return { matchId: updated.id, freeOnFootyFinder: updated.freeOnFootyFinder, firstTimersOnly: updated.firstTimersOnly, feeCents: updated.feeCents };
    });
  }

  /** Per free match and in total: the fees FootyFinder waived and its actual cash cost (the venue payable). */
  async costReport(): Promise<FreeMatchCostReport> {
    const matches = await prisma.match.findMany({
      where: { freeOnFootyFinder: true },
      orderBy: { startsAt: 'desc' },
      take: 500,
      select: {
        id: true, name: true, startsAt: true, status: true, firstTimersOnly: true,
        promotionalCosts: { where: { status: 'ACTIVE' }, select: { amountCents: true } },
        venuePayable: { select: { amountCents: true } },
        fieldReservation: { select: { status: true, priceCentsSnapshot: true } },
      },
    });
    const rows: FreeMatchCostRow[] = matches.map((match) => {
      const payable = match.venuePayable?.amountCents;
      const expected = match.status !== 'CANCELLED' && match.fieldReservation && match.fieldReservation.status !== 'CANCELLED' ? match.fieldReservation.priceCentsSnapshot : null;
      return {
        matchId: match.id,
        name: match.name,
        startsAt: match.startsAt.toISOString(),
        status: match.status,
        firstTimersOnly: match.firstTimersOnly,
        playersCovered: match.promotionalCosts.length,
        feesWaivedCents: match.promotionalCosts.reduce((total, cost) => total + cost.amountCents, 0),
        venueCostCents: payable ?? expected ?? 0,
        venueCostKind: payable !== undefined ? 'PAYABLE' : expected !== null ? 'EXPECTED' : 'NONE',
      };
    });
    return {
      matches: rows,
      totals: {
        matchCount: rows.length,
        playersCovered: rows.reduce((total, row) => total + row.playersCovered, 0),
        feesWaivedCents: rows.reduce((total, row) => total + row.feesWaivedCents, 0),
        venuePayableCents: rows.filter((row) => row.venueCostKind === 'PAYABLE').reduce((total, row) => total + row.venueCostCents, 0),
        expectedVenueCostCents: rows.filter((row) => row.venueCostKind === 'EXPECTED').reduce((total, row) => total + row.venueCostCents, 0),
      },
    };
  }
}
