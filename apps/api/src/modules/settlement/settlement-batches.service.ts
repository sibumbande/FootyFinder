import type { AdminSettlementBatch, AdminSettlementDue, SettlementBatchStatus } from '@footy-finder/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { settlementWeek, settlementWeekOf } from './settlement-week.js';
import { toAdminBeneficiary, toAdminPayable } from './venue-settlement.service.js';

const batchInclude = {
  venue: { select: { id: true, name: true } },
  beneficiary: true,
  payables: {
    include: {
      match: { select: { name: true, startsAt: true } },
      venue: { select: { id: true, name: true } },
      adjustments: { orderBy: { createdAt: 'asc' as const } },
    },
    orderBy: { dueAt: 'asc' as const },
  },
} satisfies Prisma.VenueSettlementBatchInclude;

type BatchRow = Prisma.VenueSettlementBatchGetPayload<{ include: typeof batchInclude }>;

const toAdminBatch = (row: BatchRow): AdminSettlementBatch => ({
  id: row.id,
  venue: row.venue,
  beneficiary: toAdminBeneficiary(row.beneficiary),
  periodStart: row.periodStart.toISOString(),
  periodEnd: row.periodEnd.toISOString(),
  payablesCents: row.payablesCents,
  adjustmentsCents: row.adjustmentsCents,
  totalCents: row.totalCents,
  status: row.status,
  preparedByUserId: row.preparedByUserId,
  preparedAt: row.preparedAt.toISOString(),
  approvedByUserId: row.approvedByUserId ?? undefined,
  approvedAt: row.approvedAt?.toISOString(),
  paidByUserId: row.paidByUserId ?? undefined,
  paidAt: row.paidAt?.toISOString(),
  payoutReference: row.payoutReference ?? undefined,
  evidenceNote: row.evidenceNote ?? undefined,
  cancelledByUserId: row.cancelledByUserId ?? undefined,
  cancelReason: row.cancelReason ?? undefined,
  payables: row.payables.map(toAdminPayable),
});

const lockBatch = (tx: Prisma.TransactionClient, id: string) =>
  tx.$queryRaw`SELECT "id" FROM "VenueSettlementBatch" WHERE "id" = ${id}::uuid FOR UPDATE`;

/**
 * TKT-608 (DEC-012): weekly manual venue settlement under dual control.
 * prepare (admin P) -> approve (admin != P) -> mark paid with payout reference (admin != P).
 * Each transition is a serializable transaction with a row lock and a conditional status
 * change, and is audited. The database also refuses any change to a paid batch or payable.
 */
export class SettlementBatchesService {
  async due(now = new Date()): Promise<AdminSettlementDue[]> {
    const payables = await prisma.venuePayable.findMany({
      where: { status: 'DUE' },
      select: { venueId: true, amountCents: true, dueAt: true, venue: { select: { id: true, name: true } } },
    });
    const adjustments = await prisma.venuePayableAdjustment.findMany({
      where: { appliedBatchId: null, payable: { status: { in: ['DUE', 'PAID'] } } },
      select: { amountCents: true, payable: { select: { venueId: true, venue: { select: { id: true, name: true } } } } },
    });
    const venues = new Map<string, AdminSettlementDue>();
    const lastClosed = new Date(settlementWeek(settlementWeekOf(now))!.periodStart.getTime() - 7 * 86_400_000);
    const entry = (venue: { id: string; name: string }) => {
      if (!venues.has(venue.id))
        venues.set(venue.id, {
          venue,
          payableCount: 0,
          payablesCents: 0,
          unappliedAdjustmentsCents: 0,
          latestClosedWeek: settlementWeekOf(lastClosed),
        });
      return venues.get(venue.id)!;
    };
    for (const payable of payables) {
      const row = entry(payable.venue);
      row.payableCount += 1;
      row.payablesCents += payable.amountCents;
      if (!row.oldestDueAt || payable.dueAt.toISOString() < row.oldestDueAt) row.oldestDueAt = payable.dueAt.toISOString();
    }
    for (const adjustment of adjustments) entry(adjustment.payable.venue).unappliedAdjustmentsCents += adjustment.amountCents;
    const approved = await prisma.venueBeneficiary.findMany({ where: { venueId: { in: [...venues.keys()] }, status: 'APPROVED' } });
    for (const beneficiary of approved) venues.get(beneficiary.venueId)!.approvedBeneficiary = toAdminBeneficiary(beneficiary);
    return [...venues.values()].sort((a, b) => a.venue.name.localeCompare(b.venue.name));
  }

  async list(status?: SettlementBatchStatus) {
    const rows = await prisma.venueSettlementBatch.findMany({
      where: status ? { status } : {},
      include: batchInclude,
      orderBy: [{ periodStart: 'desc' }, { preparedAt: 'desc' }],
      take: 100,
    });
    return rows.map(toAdminBatch);
  }

  async get(id: string) {
    const row = await prisma.venueSettlementBatch.findUnique({ where: { id }, include: batchInclude });
    if (!row) throw new AppError(404, 'Settlement batch not found.', 'SETTLEMENT_NOT_FOUND');
    return toAdminBatch(row);
  }

  async prepare(actorUserId: string, input: { venueId: string; weekStart: string }, requestId?: string, now = new Date()) {
    const week = settlementWeek(input.weekStart);
    if (!week) throw new AppError(400, 'Choose the Monday that starts the week (Johannesburg time).', 'SETTLEMENT_WEEK_INVALID');
    if (week.periodEnd > now) throw new AppError(409, 'A week can be settled only after it has ended.', 'SETTLEMENT_WEEK_OPEN');
    try {
      const id = await serializableTransaction(async (tx) => {
        const beneficiary = await tx.venueBeneficiary.findFirst({ where: { venueId: input.venueId, status: 'APPROVED' } });
        if (!beneficiary)
          throw new AppError(409, 'This venue has no approved bank details yet.', 'BENEFICIARY_REQUIRED');
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "VenuePayable"
          WHERE "venueId" = ${input.venueId}::uuid AND "status" = 'DUE' AND "dueAt" < ${week.periodEnd}
          ORDER BY "dueAt" FOR UPDATE`;
        const payables = await tx.venuePayable.findMany({ where: { id: { in: locked.map(({ id: payableId }) => payableId) } } });
        // DEC-012: corrections are settled with the payables they belong to, or carried into the
        // venue's next settlement when the payable was already paid.
        const adjustments = await tx.venuePayableAdjustment.findMany({
          where: {
            appliedBatchId: null,
            payable: { venueId: input.venueId },
            OR: [{ payableId: { in: payables.map((payable) => payable.id) } }, { payable: { status: 'PAID' } }],
          },
        });
        if (!payables.length && !adjustments.length)
          throw new AppError(409, 'Nothing is due for this venue up to the end of that week.', 'NOTHING_TO_SETTLE');
        const payablesCents = payables.reduce((sum, payable) => sum + payable.amountCents, 0);
        const adjustmentsCents = adjustments.reduce((sum, adjustment) => sum + adjustment.amountCents, 0);
        if (payablesCents + adjustmentsCents < 0)
          throw new AppError(409, 'Adjustments exceed what is owed; resolve them with the venue first.', 'SETTLEMENT_NEGATIVE');
        const batch = await tx.venueSettlementBatch.create({
          data: {
            venueId: input.venueId,
            beneficiaryId: beneficiary.id,
            periodStart: week.periodStart,
            periodEnd: week.periodEnd,
            payablesCents,
            adjustmentsCents,
            totalCents: payablesCents + adjustmentsCents,
            preparedByUserId: actorUserId,
          },
        });
        const moved = await tx.venuePayable.updateMany({
          where: { id: { in: payables.map((payable) => payable.id) }, status: 'DUE' },
          data: { status: 'IN_BATCH', batchId: batch.id },
        });
        if (moved.count !== payables.length) throw new AppError(409, 'Payables changed while preparing.', 'SETTLEMENT_CONFLICT');
        await tx.venuePayableAdjustment.updateMany({
          where: { id: { in: adjustments.map((adjustment) => adjustment.id) }, appliedBatchId: null },
          data: { appliedBatchId: batch.id },
        });
        await appendAdminAudit(tx, {
          actorUserId,
          action: 'VENUE_SETTLEMENT_PREPARED',
          entityType: 'VenueSettlementBatch',
          entityId: batch.id,
          requestId,
          metadata: { venueId: input.venueId, weekStart: input.weekStart, payableCount: payables.length, totalCents: batch.totalCents },
        });
        return batch.id;
      });
      return this.get(id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new AppError(409, 'A settlement for this venue and week already exists.', 'SETTLEMENT_EXISTS');
      throw error;
    }
  }

  async approve(actorUserId: string, batchId: string, requestId?: string) {
    await serializableTransaction(async (tx) => {
      await lockBatch(tx, batchId);
      const batch = await tx.venueSettlementBatch.findUnique({ where: { id: batchId }, include: { beneficiary: true } });
      if (!batch) throw new AppError(404, 'Settlement batch not found.', 'SETTLEMENT_NOT_FOUND');
      if (batch.status !== 'PREPARED') throw new AppError(409, 'Only a prepared settlement can be approved.', 'SETTLEMENT_NOT_PREPARED');
      if (batch.preparedByUserId === actorUserId)
        throw new AppError(403, 'A different MFA-verified administrator must approve this settlement.', 'SETTLEMENT_DUAL_CONTROL_REQUIRED');
      if (batch.beneficiary.status !== 'APPROVED')
        throw new AppError(409, 'The venue bank details changed after preparation. Cancel and prepare again.', 'BENEFICIARY_CHANGED');
      const updated = await tx.venueSettlementBatch.updateMany({
        where: { id: batchId, status: 'PREPARED' },
        data: { status: 'APPROVED', approvedByUserId: actorUserId, approvedAt: new Date() },
      });
      if (updated.count !== 1) throw new AppError(409, 'Settlement changed while approving.', 'SETTLEMENT_CONFLICT');
      await appendAdminAudit(tx, {
        actorUserId,
        action: 'VENUE_SETTLEMENT_APPROVED',
        entityType: 'VenueSettlementBatch',
        entityId: batchId,
        requestId,
        metadata: { totalCents: batch.totalCents },
      });
    });
    return this.get(batchId);
  }

  async markPaid(actorUserId: string, batchId: string, input: { payoutReference: string; evidenceNote: string }, requestId?: string) {
    try {
      await serializableTransaction(async (tx) => {
        await lockBatch(tx, batchId);
        const batch = await tx.venueSettlementBatch.findUnique({ where: { id: batchId } });
        if (!batch) throw new AppError(404, 'Settlement batch not found.', 'SETTLEMENT_NOT_FOUND');
        if (batch.status === 'PAID') throw new AppError(409, 'This settlement is already paid.', 'SETTLEMENT_ALREADY_PAID');
        if (batch.status !== 'APPROVED') throw new AppError(409, 'Only an approved settlement can be marked paid.', 'SETTLEMENT_NOT_APPROVED');
        if (batch.preparedByUserId === actorUserId)
          throw new AppError(403, 'The preparer cannot mark their own settlement paid.', 'SETTLEMENT_DUAL_CONTROL_REQUIRED');
        const now = new Date();
        const payables = await tx.venuePayable.updateMany({
          where: { batchId, status: 'IN_BATCH' },
          data: { status: 'PAID', paidAt: now },
        });
        const expected = await tx.venuePayable.count({ where: { batchId } });
        if (payables.count !== expected) throw new AppError(409, 'A payable in this settlement is no longer payable.', 'SETTLEMENT_CONFLICT');
        const updated = await tx.venueSettlementBatch.updateMany({
          where: { id: batchId, status: 'APPROVED' },
          data: { status: 'PAID', paidByUserId: actorUserId, paidAt: now, payoutReference: input.payoutReference, evidenceNote: input.evidenceNote },
        });
        if (updated.count !== 1) throw new AppError(409, 'Settlement changed while marking it paid.', 'SETTLEMENT_CONFLICT');
        await appendAdminAudit(tx, {
          actorUserId,
          action: 'VENUE_SETTLEMENT_PAID',
          entityType: 'VenueSettlementBatch',
          entityId: batchId,
          requestId,
          metadata: { totalCents: batch.totalCents, payoutReference: input.payoutReference, payableCount: payables.count },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new AppError(409, 'That payout reference is already used.', 'PAYOUT_REFERENCE_USED');
      throw error;
    }
    return this.get(batchId);
  }

  async cancel(actorUserId: string, batchId: string, reason: string, requestId?: string) {
    await serializableTransaction(async (tx) => {
      await lockBatch(tx, batchId);
      const batch = await tx.venueSettlementBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new AppError(404, 'Settlement batch not found.', 'SETTLEMENT_NOT_FOUND');
      if (batch.status !== 'PREPARED' && batch.status !== 'APPROVED')
        throw new AppError(409, 'Only an unpaid settlement can be cancelled.', 'SETTLEMENT_NOT_CANCELLABLE');
      await tx.venuePayable.updateMany({ where: { batchId, status: 'IN_BATCH' }, data: { status: 'DUE', batchId: null } });
      await tx.venuePayableAdjustment.updateMany({ where: { appliedBatchId: batchId }, data: { appliedBatchId: null } });
      await tx.venueSettlementBatch.update({
        where: { id: batchId },
        data: { status: 'CANCELLED', cancelledByUserId: actorUserId, cancelledAt: new Date(), cancelReason: reason },
      });
      await appendAdminAudit(tx, {
        actorUserId,
        action: 'VENUE_SETTLEMENT_CANCELLED',
        entityType: 'VenueSettlementBatch',
        entityId: batchId,
        requestId,
        metadata: { reason, previousStatus: batch.status },
      });
    });
    return this.get(batchId);
  }
}
