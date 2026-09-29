import { randomUUID } from 'node:crypto';
import type {
  AdminVenueBeneficiary,
  AdminVenuePayable,
  CreateVenueBeneficiaryInput,
  VenueBankDetails,
  VenuePayableStatus,
} from '@footy-finder/shared';
import type { VenueBeneficiary } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { decryptField, encryptField, fieldKeyVersion } from '../../security/field-encryption.js';
import { appendAdminAudit } from '../admin/admin-audit.js';

const boundTo = (id: string) => `venue-beneficiary:${id}`;

export const toAdminBeneficiary = (row: VenueBeneficiary): AdminVenueBeneficiary => ({
  id: row.id,
  venueId: row.venueId,
  displayName: row.displayName,
  accountLast4: row.accountLast4,
  status: row.status,
  linkedUserId: row.linkedUserId ?? undefined,
  createdByUserId: row.createdByUserId,
  approvedByUserId: row.approvedByUserId ?? undefined,
  approvedAt: row.approvedAt?.toISOString(),
  createdAt: row.createdAt.toISOString(),
});

const payableInclude = {
  match: { select: { name: true, startsAt: true } },
  venue: { select: { id: true, name: true } },
  adjustments: { orderBy: { createdAt: 'asc' as const } },
};

type PayableRow = Awaited<ReturnType<typeof loadPayable>>;
const loadPayable = (id: string) =>
  prisma.venuePayable.findUniqueOrThrow({ where: { id }, include: payableInclude });

export const toAdminPayable = (row: NonNullable<PayableRow>): AdminVenuePayable => ({
  id: row.id,
  reservationId: row.reservationId,
  matchId: row.matchId,
  matchName: row.match.name,
  kickoffAt: row.match.startsAt.toISOString(),
  venue: row.venue,
  amountCents: row.amountCents,
  adjustmentsCents: row.adjustments.reduce((sum, item) => sum + item.amountCents, 0),
  status: row.status,
  dueAt: row.dueAt.toISOString(),
  paidAt: row.paidAt?.toISOString(),
  adjustments: row.adjustments.map((item) => ({
    id: item.id,
    amountCents: item.amountCents,
    reason: item.reason,
    actorUserId: item.actorUserId,
    createdAt: item.createdAt.toISOString(),
  })),
});

/**
 * TKT-607 (DEC-012): venue beneficiaries and payables. Admin-only; the /admin router already
 * requires a platform admin with a verified MFA session. Bank details are encrypted at rest,
 * shown masked everywhere, and revealed in full only through an audited call.
 */
export class VenueSettlementService {
  async beneficiaries(venueId: string) {
    const rows = await prisma.venueBeneficiary.findMany({ where: { venueId }, orderBy: { createdAt: 'desc' } });
    return rows.map(toAdminBeneficiary);
  }

  async createBeneficiary(actorUserId: string, venueId: string, input: CreateVenueBeneficiaryInput, requestId?: string) {
    return serializableTransaction(async (tx) => {
      const venue = await tx.managedVenue.findUnique({ where: { id: venueId }, select: { id: true } });
      if (!venue) throw new AppError(404, 'Venue not found.', 'VENUE_NOT_FOUND');
      const id = randomUUID();
      const row = await tx.venueBeneficiary.create({
        data: {
          id,
          venueId,
          displayName: input.displayName,
          encryptedDetails: encryptField(JSON.stringify(input.details), boundTo(id)),
          keyVersion: fieldKeyVersion,
          accountLast4: input.details.accountNumber.slice(-4),
          linkedUserId: input.linkedUserId,
          createdByUserId: actorUserId,
        },
      });
      await appendAdminAudit(tx, {
        actorUserId,
        action: 'VENUE_BENEFICIARY_CREATED',
        entityType: 'VenueBeneficiary',
        entityId: id,
        requestId,
        metadata: { venueId, displayName: input.displayName, accountLast4: row.accountLast4 },
      });
      return toAdminBeneficiary(row);
    });
  }

  /** D8: a different MFA-verified admin approves; the venue's previous approved details retire. */
  async approveBeneficiary(actorUserId: string, beneficiaryId: string, requestId?: string) {
    return serializableTransaction(async (tx) => {
      const row = await tx.venueBeneficiary.findUnique({ where: { id: beneficiaryId } });
      if (!row) throw new AppError(404, 'Beneficiary not found.', 'BENEFICIARY_NOT_FOUND');
      if (row.status !== 'PENDING_APPROVAL')
        throw new AppError(409, 'Only pending bank details can be approved.', 'BENEFICIARY_NOT_PENDING');
      if (row.createdByUserId === actorUserId)
        throw new AppError(403, 'A different MFA-verified administrator must approve bank details.', 'BENEFICIARY_DUAL_CONTROL_REQUIRED');
      const now = new Date();
      await tx.venueBeneficiary.updateMany({
        where: { venueId: row.venueId, status: 'APPROVED' },
        data: { status: 'RETIRED', retiredAt: now },
      });
      const approved = await tx.venueBeneficiary.update({
        where: { id: row.id },
        data: { status: 'APPROVED', approvedByUserId: actorUserId, approvedAt: now },
      });
      await appendAdminAudit(tx, {
        actorUserId,
        action: 'VENUE_BENEFICIARY_APPROVED',
        entityType: 'VenueBeneficiary',
        entityId: row.id,
        requestId,
        metadata: { venueId: row.venueId, accountLast4: row.accountLast4 },
      });
      return toAdminBeneficiary(approved);
    });
  }

  /** Full bank details for the admin making the manual payment. Every reveal is audited. */
  async revealBeneficiary(actorUserId: string, beneficiaryId: string, requestId?: string): Promise<VenueBankDetails> {
    const row = await prisma.venueBeneficiary.findUnique({ where: { id: beneficiaryId } });
    if (!row) throw new AppError(404, 'Beneficiary not found.', 'BENEFICIARY_NOT_FOUND');
    await prisma.$transaction((tx) =>
      appendAdminAudit(tx, {
        actorUserId,
        action: 'VENUE_BENEFICIARY_REVEALED',
        entityType: 'VenueBeneficiary',
        entityId: row.id,
        requestId,
        metadata: { venueId: row.venueId, accountLast4: row.accountLast4 },
      }),
    );
    return JSON.parse(decryptField(row.encryptedDetails, boundTo(row.id))) as VenueBankDetails;
  }

  async payables(query: { status?: VenuePayableStatus; venueId?: string }) {
    const rows = await prisma.venuePayable.findMany({
      where: { ...(query.status && { status: query.status }), ...(query.venueId && { venueId: query.venueId }) },
      include: payableInclude,
      orderBy: { dueAt: 'asc' },
      take: 200,
    });
    return rows.map(toAdminPayable);
  }

  /**
   * DEC-012: a reasoned correction. On an unpaid payable it changes what the next settlement pays
   * (the net may not go below zero); on a paid payable it is carried into the venue's next batch.
   * A payable inside a prepared batch is locked: cancel the batch first.
   */
  async addAdjustment(actorUserId: string, payableId: string, input: { amountCents: number; reason: string }, requestId?: string) {
    await serializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "VenuePayable" WHERE "id" = ${payableId}::uuid FOR UPDATE`;
      const payable = await tx.venuePayable.findUnique({ where: { id: payableId }, include: { adjustments: true } });
      if (!payable) throw new AppError(404, 'Payable not found.', 'PAYABLE_NOT_FOUND');
      if (payable.status === 'IN_BATCH' || payable.status === 'VOID')
        throw new AppError(409, 'This payable is locked in a settlement batch or void.', 'PAYABLE_LOCKED');
      const net = payable.amountCents + payable.adjustments.reduce((sum, item) => sum + item.amountCents, 0) + input.amountCents;
      if (payable.status === 'DUE' && net < 0)
        throw new AppError(400, 'An adjustment cannot make an unpaid payable negative.', 'ADJUSTMENT_INVALID');
      const adjustment = await tx.venuePayableAdjustment.create({
        data: { payableId, amountCents: input.amountCents, reason: input.reason, actorUserId },
      });
      await appendAdminAudit(tx, {
        actorUserId,
        action: 'VENUE_PAYABLE_ADJUSTED',
        entityType: 'VenuePayable',
        entityId: payableId,
        requestId,
        metadata: { adjustmentId: adjustment.id, amountCents: input.amountCents, reason: input.reason },
      });
    });
    return toAdminPayable(await loadPayable(payableId));
  }
}
