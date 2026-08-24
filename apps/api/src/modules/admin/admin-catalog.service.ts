import type {
  ManagedFieldAvailabilityInput,
  ManagedFieldExceptionInput,
  ManagedFieldInput,
  ManagedFieldPriceInput,
  ManagedVenueInput,
} from '@footy-finder/shared';
import type { ManagedVenue } from '@footy-finder/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { appendAdminAudit } from './admin-audit.js';

const include = {
  fields: {
    include: {
      supportedFormats: true,
      availabilityPeriods: { orderBy: [{ dayOfWeek: 'asc' as const }, { startMinute: 'asc' as const }] },
      exceptions: { orderBy: { startsAt: 'asc' as const } },
      prices: { orderBy: { effectiveFrom: 'desc' as const } },
    },
    orderBy: { name: 'asc' as const },
  },
} satisfies Prisma.ManagedVenueInclude;

type CatalogVenue = Prisma.ManagedVenueGetPayload<{ include: typeof include }>;

const venueDto = (venue: CatalogVenue): ManagedVenue => ({
  id: venue.id,
  name: venue.name,
  addressLine1: venue.addressLine1,
  ...(venue.addressLine2 ? { addressLine2: venue.addressLine2 } : {}),
  city: venue.city,
  region: venue.region,
  ...(venue.postalCode ? { postalCode: venue.postalCode } : {}),
  countryCode: venue.countryCode,
  ...(venue.latitude !== null ? { latitude: Number(venue.latitude) } : {}),
  ...(venue.longitude !== null ? { longitude: Number(venue.longitude) } : {}),
  timezone: venue.timezone,
  isActive: venue.isActive,
  createdAt: venue.createdAt.toISOString(),
  updatedAt: venue.updatedAt.toISOString(),
  fields: venue.fields.map((field) => ({
    id: field.id,
    venueId: field.venueId,
    name: field.name,
    ...(field.description ? { description: field.description } : {}),
    status: field.status,
    supportedFormats: field.supportedFormats.map(({ format }) => format),
    availabilityPeriods: field.availabilityPeriods.map((period) => ({
      id: period.id,
      dayOfWeek: period.dayOfWeek,
      startMinute: period.startMinute,
      endMinute: period.endMinute,
    })),
    exceptions: field.exceptions.map((exception) => ({
      id: exception.id,
      startsAt: exception.startsAt.toISOString(),
      endsAt: exception.endsAt.toISOString(),
      available: exception.available,
      ...(exception.reason ? { reason: exception.reason } : {}),
    })),
    prices: field.prices.map((price) => ({
      id: price.id,
      amountCents: price.amountCents,
      currency: 'ZAR' as const,
      effectiveFrom: price.effectiveFrom.toISOString(),
      ...(price.effectiveTo ? { effectiveTo: price.effectiveTo.toISOString() } : {}),
    })),
    createdAt: field.createdAt.toISOString(),
    updatedAt: field.updatedAt.toISOString(),
  })),
});

export const assertNonOverlappingAvailability = (input: ManagedFieldAvailabilityInput) => {
  for (const day of new Set(input.periods.map((period) => period.dayOfWeek))) {
    const periods = input.periods
      .filter((period) => period.dayOfWeek === day)
      .sort((a, b) => a.startMinute - b.startMinute);
    if (
      periods.some(
        (period, index) => index > 0 && period.startMinute < periods[index - 1]!.endMinute,
      )
    )
      throw new AppError(
        409,
        'Weekly availability periods cannot overlap.',
        'FIELD_AVAILABILITY_OVERLAP',
      );
  }
};

export class AdminCatalogService {
  async list() {
    return (await prisma.managedVenue.findMany({
      include,
      orderBy: [{ city: 'asc' }, { name: 'asc' }],
    })).map(venueDto);
  }
  async createVenue(input: ManagedVenueInput, actorUserId: string, requestId?: string) {
    return venueDto(await serializableTransaction(async (tx) => {
      const venue = await tx.managedVenue.create({ data: input, include });
      await appendAdminAudit(tx, { actorUserId, action: 'VENUE_CREATED', entityType: 'MANAGED_VENUE', entityId: venue.id, requestId });
      return venue;
    }));
  }
  async updateVenue(id: string, input: ManagedVenueInput, actorUserId: string, requestId?: string) {
    return venueDto(await serializableTransaction(async (tx) => {
      const venue = await tx.managedVenue.update({ where: { id }, data: input, include });
      await appendAdminAudit(tx, { actorUserId, action: 'VENUE_UPDATED', entityType: 'MANAGED_VENUE', entityId: id, requestId });
      return venue;
    }));
  }
  async createField(venueId: string, input: ManagedFieldInput, actorUserId: string, requestId?: string) {
    return venueDto(await serializableTransaction(async (tx) => {
      const field = await tx.managedField.create({ data: { venueId, name: input.name, description: input.description, status: input.status, supportedFormats: { create: input.supportedFormats.map((format) => ({ format })) } } });
      await appendAdminAudit(tx, { actorUserId, action: 'FIELD_CREATED', entityType: 'MANAGED_FIELD', entityId: field.id, requestId, metadata: { venueId } });
      return tx.managedVenue.findUniqueOrThrow({ where: { id: venueId }, include });
    }));
  }
  async updateField(fieldId: string, input: ManagedFieldInput, actorUserId: string, requestId?: string) {
    return venueDto(await serializableTransaction(async (tx) => {
      const field = await tx.managedField.update({
        where: { id: fieldId },
        data: {
          name: input.name,
          description: input.description,
          status: input.status,
          supportedFormats: {
            deleteMany: {},
            create: input.supportedFormats.map((format) => ({ format })),
          },
        },
      });
      await appendAdminAudit(tx, { actorUserId, action: 'FIELD_UPDATED', entityType: 'MANAGED_FIELD', entityId: fieldId, requestId });
      return tx.managedVenue.findUniqueOrThrow({ where: { id: field.venueId }, include });
    }));
  }
  async replaceAvailability(fieldId: string, input: ManagedFieldAvailabilityInput, actorUserId: string, requestId?: string) {
    assertNonOverlappingAvailability(input);
    return venueDto(await serializableTransaction(async (tx) => {
      const field = await tx.managedField.findUniqueOrThrow({ where: { id: fieldId } });
      await tx.managedFieldAvailability.deleteMany({ where: { fieldId } });
      if (input.periods.length) await tx.managedFieldAvailability.createMany({ data: input.periods.map((period) => ({ ...period, fieldId })) });
      await appendAdminAudit(tx, { actorUserId, action: 'FIELD_AVAILABILITY_REPLACED', entityType: 'MANAGED_FIELD', entityId: fieldId, requestId, metadata: { periodCount: input.periods.length } });
      return tx.managedVenue.findUniqueOrThrow({ where: { id: field.venueId }, include });
    }));
  }
  async addException(fieldId: string, input: ManagedFieldExceptionInput, actorUserId: string, requestId?: string) {
    return venueDto(await serializableTransaction(async (tx) => {
      const field = await tx.managedField.findUniqueOrThrow({ where: { id: fieldId } });
      const exception = await tx.managedFieldException.create({ data: { fieldId, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), available: input.available, reason: input.reason } });
      await appendAdminAudit(tx, { actorUserId, action: 'FIELD_EXCEPTION_CREATED', entityType: 'FIELD_EXCEPTION', entityId: exception.id, requestId, metadata: { fieldId } });
      return tx.managedVenue.findUniqueOrThrow({ where: { id: field.venueId }, include });
    }));
  }
  async removeException(fieldId: string, exceptionId: string, actorUserId: string, requestId?: string) {
    return venueDto(await serializableTransaction(async (tx) => {
      const field = await tx.managedField.findUniqueOrThrow({ where: { id: fieldId } });
      const removed = await tx.managedFieldException.deleteMany({ where: { id: exceptionId, fieldId } });
      if (!removed.count) throw new AppError(404, 'The field exception was not found.', 'RESOURCE_NOT_FOUND');
      await appendAdminAudit(tx, { actorUserId, action: 'FIELD_EXCEPTION_REMOVED', entityType: 'FIELD_EXCEPTION', entityId: exceptionId, requestId, metadata: { fieldId } });
      return tx.managedVenue.findUniqueOrThrow({ where: { id: field.venueId }, include });
    }));
  }
  async addPrice(fieldId: string, input: ManagedFieldPriceInput, actorUserId: string, requestId?: string) {
    try {
      return venueDto(await serializableTransaction(async (tx) => {
        const field = await tx.managedField.findUniqueOrThrow({ where: { id: fieldId } });
        const from = new Date(input.effectiveFrom); const to = input.effectiveTo ? new Date(input.effectiveTo) : null;
        const overlap = await tx.managedFieldPrice.findFirst({ where: { fieldId, effectiveFrom: { lt: to ?? new Date('9999-12-31') }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }] } });
        if (overlap) throw new AppError(409, 'That price period overlaps existing history.', 'FIELD_PRICE_OVERLAP');
        const price = await tx.managedFieldPrice.create({ data: { fieldId, amountCents: input.amountCents, effectiveFrom: from, effectiveTo: to } });
        await appendAdminAudit(tx, { actorUserId, action: 'FIELD_PRICE_CREATED', entityType: 'FIELD_PRICE', entityId: price.id, requestId, metadata: { fieldId, amountCents: input.amountCents } });
        return tx.managedVenue.findUniqueOrThrow({ where: { id: field.venueId }, include });
      }));
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2004' &&
        String(error.meta?.database_error).includes('ManagedFieldPrice_no_overlap')
      )
        throw new AppError(409, 'That price period overlaps existing history.', 'FIELD_PRICE_OVERLAP');
      throw error;
    }
  }
}
