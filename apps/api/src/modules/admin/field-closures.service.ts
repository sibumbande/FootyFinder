import type { FieldClosureClash, FieldClosureInput, FieldClosureResult } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { overlapsClosure, type FieldClosureRow } from '../venues/field-closures.js';
import { appendAdminAudit } from './admin-audit.js';
import { include, venueDto } from './admin-catalog.service.js';

/**
 * CEO touch-up batch 3, item 3 (D1): an admin closes a field for set times. Closures go live immediately (fresh
 * MFA, an internal reason and an audit entry) and the venue stays published: they only remove bookable time.
 * Matches already booked into a closed time are listed for the admin, who can use "Cancel match
 * (weather/venue)"; nothing is cancelled automatically.
 */
export class FieldClosuresService {
  async add(fieldId: string, input: FieldClosureInput, actorUserId: string, requestId?: string): Promise<FieldClosureResult> {
    const venue = await serializableTransaction(async (tx) => {
      const field = await tx.managedField.findUniqueOrThrow({ where: { id: fieldId }, select: { venueId: true } });
      const closure = await tx.managedFieldClosure.create({
        data: input.kind === 'ONE_OFF'
          ? { fieldId, kind: 'ONE_OFF', startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), reason: input.reason, createdByUserId: actorUserId }
          : {
              fieldId, kind: 'WEEKLY', dayOfWeek: input.dayOfWeek, startMinute: input.startMinute, endMinute: input.endMinute,
              startsOn: new Date(`${input.startsOn}T00:00:00Z`), ...(input.endsOn ? { endsOn: new Date(`${input.endsOn}T00:00:00Z`) } : {}),
              reason: input.reason, createdByUserId: actorUserId,
            },
      });
      await appendAdminAudit(tx, { actorUserId, action: 'FIELD_CLOSURE_CREATED', entityType: 'MANAGED_FIELD', entityId: fieldId, requestId, metadata: { closureId: closure.id, kind: closure.kind, reason: input.reason } });
      return tx.managedVenue.findUniqueOrThrow({ where: { id: field.venueId }, include });
    });
    return { venue: venueDto(venue), clashes: await this.clashes(fieldId) };
  }

  async remove(fieldId: string, closureId: string, reason: string, actorUserId: string, requestId?: string) {
    const venue = await serializableTransaction(async (tx) => {
      const field = await tx.managedField.findUniqueOrThrow({ where: { id: fieldId }, select: { venueId: true } });
      const removed = await tx.managedFieldClosure.updateMany({ where: { id: closureId, fieldId, removedAt: null }, data: { removedAt: new Date(), removedByUserId: actorUserId } });
      if (!removed.count) throw new AppError(404, 'That closure was not found or is already removed.', 'RESOURCE_NOT_FOUND');
      await appendAdminAudit(tx, { actorUserId, action: 'FIELD_CLOSURE_REMOVED', entityType: 'MANAGED_FIELD', entityId: fieldId, requestId, metadata: { closureId, reason } });
      return tx.managedVenue.findUniqueOrThrow({ where: { id: field.venueId }, include });
    });
    return venueDto(venue);
  }

  /** Upcoming, still-booked matches on this field whose time falls inside any active closure. */
  async clashes(fieldId: string, now = new Date()): Promise<FieldClosureClash[]> {
    const field = await prisma.managedField.findUniqueOrThrow({
      where: { id: fieldId },
      select: { venue: { select: { timezone: true } }, closures: { where: { removedAt: null } } },
    });
    if (!field.closures.length) return [];
    const reservations = await prisma.fieldReservation.findMany({
      where: { fieldId, status: { in: ['FUNDING', 'CONFIRMED'] }, endsAt: { gt: now }, match: { status: { notIn: ['CANCELLED', 'COMPLETED'] } } },
      select: { startsAt: true, endsAt: true, match: { select: { id: true, name: true, status: true } } },
      orderBy: { startsAt: 'asc' },
    });
    return reservations
      .filter((reservation) => reservation.match && overlapsClosure(field.closures as FieldClosureRow[], reservation.startsAt, reservation.endsAt, field.venue.timezone))
      .map((reservation) => ({
        matchId: reservation.match!.id,
        matchName: reservation.match!.name,
        status: reservation.match!.status,
        startsAt: reservation.startsAt.toISOString(),
        endsAt: reservation.endsAt.toISOString(),
      }));
  }
}
