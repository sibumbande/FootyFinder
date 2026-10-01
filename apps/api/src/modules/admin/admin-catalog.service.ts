import type {
  ManagedFieldAvailabilityInput,
  ManagedFieldExceptionInput,
  ManagedFieldInput,
  ManagedFieldPriceInput,
  ManagedVenueInput,
  ManagedVenueMediaInput,
  VenueCancellationPolicyInput,
} from '@footy-finder/shared';
import type { ManagedVenue, VenueContentChangeView, VenueContentPayload } from '@footy-finder/shared';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { appendAdminAudit } from './admin-audit.js';

export const include = {
  fields: {
    include: {
      supportedFormats: true,
      availabilityPeriods: { orderBy: [{ dayOfWeek: 'asc' as const }, { startMinute: 'asc' as const }] },
      exceptions: { orderBy: { startsAt: 'asc' as const } },
      prices: { orderBy: { effectiveFrom: 'desc' as const } },
    },
    orderBy: { name: 'asc' as const },
  },
  media: { orderBy: { sortOrder: 'asc' as const } },
  cancellationPolicies: { orderBy: { effectiveFrom: 'desc' as const } },
  contentChanges: { where: { status: 'PENDING' as const }, take: 1 },
  links: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.ManagedVenueInclude;

export type CatalogVenue = Prisma.ManagedVenueGetPayload<{ include: typeof include }>;

export const venueDto = (venue: CatalogVenue): ManagedVenue => ({
  id: venue.id,
  slug: venue.slug,
  name: venue.name,
  ...(venue.publicDescription ? { publicDescription: venue.publicDescription } : {}),
  addressLine1: venue.addressLine1,
  ...(venue.addressLine2 ? { addressLine2: venue.addressLine2 } : {}),
  city: venue.city,
  region: venue.region,
  ...(venue.postalCode ? { postalCode: venue.postalCode } : {}),
  countryCode: venue.countryCode,
  ...(venue.latitude !== null ? { latitude: Number(venue.latitude) } : {}),
  ...(venue.longitude !== null ? { longitude: Number(venue.longitude) } : {}),
  timezone: venue.timezone,
  amenities: venue.amenities,
  ...(venue.coverImageUrl ? { coverImageUrl: venue.coverImageUrl } : {}),
  ...(venue.coverImageAlt ? { coverImageAlt: venue.coverImageAlt } : {}),
  ...(venue.coverImageAttribution ? { coverImageAttribution: venue.coverImageAttribution } : {}),
  publicationStatus: venue.publicationStatus,
  ...(venue.submittedByUserId ? { submittedByUserId: venue.submittedByUserId } : {}),
  ...(venue.submittedAt ? { submittedAt: venue.submittedAt.toISOString() } : {}),
  ...(venue.approvedByUserId ? { approvedByUserId: venue.approvedByUserId } : {}),
  ...(venue.approvedAt ? { approvedAt: venue.approvedAt.toISOString() } : {}),
  ...(venue.deactivatedAt ? { deactivatedAt: venue.deactivatedAt.toISOString() } : {}),
  ...(venue.deactivationReason ? { deactivationReason: venue.deactivationReason } : {}),
  isActive: venue.isActive,
  media: venue.media.map(({ id, url, thumbUrl, altText, attribution, sortOrder }) => ({ id, url, ...(thumbUrl ? { thumbUrl } : {}), altText, attribution, sortOrder })),
  ...(venue.aboutText ? { aboutText: venue.aboutText } : {}),
  links: venue.links.map(({ type, label, url }) => ({ type, label, url })),
  ...(venue.contentChanges[0] ? { pendingContentChange: contentChangeView(venue.contentChanges[0]) } : {}),
  cancellationPolicies: venue.cancellationPolicies.map((policy) => ({
    id: policy.id, effectiveFrom: policy.effectiveFrom.toISOString(), ...(policy.effectiveTo ? { effectiveTo: policy.effectiveTo.toISOString() } : {}),
    fullCreditBeforeHours: policy.fullCreditBeforeHours, lateCreditPercent: policy.lateCreditPercent,
    venueCancellationPercent: policy.venueCancellationPercent, policyText: policy.policyText,
  })),
  createdAt: venue.createdAt.toISOString(),
  updatedAt: venue.updatedAt.toISOString(),
  fields: venue.fields.map((field) => ({
    id: field.id,
    venueId: field.venueId,
    name: field.name,
    ...(field.description ? { description: field.description } : {}),
    status: field.status,
    turnaroundBufferMinutes: field.turnaroundBufferMinutes,
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
      ...(price.format ? { format: price.format } : {}),
      ...(price.dayOfWeek === null ? {} : { dayOfWeek: price.dayOfWeek }),
      ...(price.startMinute === null ? {} : { startMinute: price.startMinute }),
      ...(price.endMinute === null ? {} : { endMinute: price.endMinute }),
      effectiveFrom: price.effectiveFrom.toISOString(),
      ...(price.effectiveTo ? { effectiveTo: price.effectiveTo.toISOString() } : {}),
    })),
    createdAt: field.createdAt.toISOString(),
    updatedAt: field.updatedAt.toISOString(),
  })),
});

const contentChangeView = (change: CatalogVenue['contentChanges'][number]): VenueContentChangeView => ({
  id: change.id,
  submittedByUserId: change.submittedByUserId,
  submittedAt: change.submittedAt.toISOString(),
  payload: change.payload as unknown as VenueContentPayload,
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
      const slugBase = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'venue';
      const slug = input.slug ?? `${slugBase}-${randomUUID().slice(0, 8)}`;
      const venue = await tx.managedVenue.create({ data: { ...input, amenities: input.amenities ?? [], isActive: input.isActive ?? true, timezone: input.timezone ?? 'Africa/Johannesburg', slug, publicationStatus: 'DRAFT' }, include });
      await appendAdminAudit(tx, { actorUserId, action: 'VENUE_CREATED', entityType: 'MANAGED_VENUE', entityId: venue.id, requestId });
      return venue;
    }));
  }
  async updateVenue(id: string, input: ManagedVenueInput, actorUserId: string, requestId?: string) {
    return venueDto(await serializableTransaction(async (tx) => {
      const { slug: _frozenSlug, ...changes } = input;
      const venue = await tx.managedVenue.update({ where: { id }, data: { ...changes, amenities: changes.amenities ?? [], isActive: changes.isActive ?? true, timezone: changes.timezone ?? 'Africa/Johannesburg', publicationStatus: 'DRAFT', submittedByUserId: null, submittedAt: null, approvedByUserId: null, approvedAt: null }, include });
      await appendAdminAudit(tx, { actorUserId, action: 'VENUE_UPDATED', entityType: 'MANAGED_VENUE', entityId: id, requestId });
      return venue;
    }));
  }
  async createField(venueId: string, input: ManagedFieldInput, actorUserId: string, requestId?: string) {
    return venueDto(await serializableTransaction(async (tx) => {
      const field = await tx.managedField.create({ data: { venueId, name: input.name, description: input.description, status: input.status ?? 'ACTIVE', turnaroundBufferMinutes: input.turnaroundBufferMinutes ?? 15, supportedFormats: { create: input.supportedFormats.map((format) => ({ format })) } } });
      await markVenueDraft(tx, venueId);
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
          status: input.status ?? 'ACTIVE',
          turnaroundBufferMinutes: input.turnaroundBufferMinutes ?? 15,
          supportedFormats: {
            deleteMany: {},
            create: input.supportedFormats.map((format) => ({ format })),
          },
        },
      });
      await markVenueDraft(tx, field.venueId);
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
      await markVenueDraft(tx, field.venueId);
      await appendAdminAudit(tx, { actorUserId, action: 'FIELD_AVAILABILITY_REPLACED', entityType: 'MANAGED_FIELD', entityId: fieldId, requestId, metadata: { periodCount: input.periods.length } });
      return tx.managedVenue.findUniqueOrThrow({ where: { id: field.venueId }, include });
    }));
  }
  async addException(fieldId: string, input: ManagedFieldExceptionInput, actorUserId: string, requestId?: string) {
    return venueDto(await serializableTransaction(async (tx) => {
      const field = await tx.managedField.findUniqueOrThrow({ where: { id: fieldId } });
      const exception = await tx.managedFieldException.create({ data: { fieldId, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), available: input.available, reason: input.reason } });
      await markVenueDraft(tx, field.venueId);
      await appendAdminAudit(tx, { actorUserId, action: 'FIELD_EXCEPTION_CREATED', entityType: 'FIELD_EXCEPTION', entityId: exception.id, requestId, metadata: { fieldId } });
      return tx.managedVenue.findUniqueOrThrow({ where: { id: field.venueId }, include });
    }));
  }
  async removeException(fieldId: string, exceptionId: string, actorUserId: string, requestId?: string) {
    return venueDto(await serializableTransaction(async (tx) => {
      const field = await tx.managedField.findUniqueOrThrow({ where: { id: fieldId } });
      const removed = await tx.managedFieldException.deleteMany({ where: { id: exceptionId, fieldId } });
      if (!removed.count) throw new AppError(404, 'The field exception was not found.', 'RESOURCE_NOT_FOUND');
      await markVenueDraft(tx, field.venueId);
      await appendAdminAudit(tx, { actorUserId, action: 'FIELD_EXCEPTION_REMOVED', entityType: 'FIELD_EXCEPTION', entityId: exceptionId, requestId, metadata: { fieldId } });
      return tx.managedVenue.findUniqueOrThrow({ where: { id: field.venueId }, include });
    }));
  }
  async addPrice(fieldId: string, input: ManagedFieldPriceInput, actorUserId: string, requestId?: string) {
    try {
      return venueDto(await serializableTransaction(async (tx) => {
        const field = await tx.managedField.findUniqueOrThrow({ where: { id: fieldId } });
        const from = new Date(input.effectiveFrom); const to = input.effectiveTo ? new Date(input.effectiveTo) : null;
        const overlap = await tx.managedFieldPrice.findFirst({ where: {
          fieldId, format: input.format ?? null, dayOfWeek: input.dayOfWeek ?? null,
          startMinute: input.startMinute ?? null, endMinute: input.endMinute ?? null,
          effectiveFrom: { lt: to ?? new Date('9999-12-31') }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }],
        } });
        if (overlap) throw new AppError(409, 'That price period overlaps existing history.', 'FIELD_PRICE_OVERLAP');
        const price = await tx.managedFieldPrice.create({ data: { fieldId, amountCents: input.amountCents, format: input.format, dayOfWeek: input.dayOfWeek, startMinute: input.startMinute, endMinute: input.endMinute, effectiveFrom: from, effectiveTo: to } });
        await markVenueDraft(tx, field.venueId);
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

  async replaceMedia(venueId: string, input: ManagedVenueMediaInput, actorUserId: string, requestId?: string) {
    return venueDto(await serializableTransaction(async (tx) => {
      await tx.managedVenue.findUniqueOrThrow({ where: { id: venueId } });
      await tx.managedVenueMedia.deleteMany({ where: { venueId } });
      await tx.managedVenueMedia.createMany({ data: input.items.map((item, sortOrder) => ({ venueId, sortOrder, ...item })) });
      await tx.managedVenue.update({ where: { id: venueId }, data: { publicationStatus: 'DRAFT', submittedByUserId: null, submittedAt: null, approvedByUserId: null, approvedAt: null } });
      await appendAdminAudit(tx, { actorUserId, action: 'VENUE_MEDIA_REPLACED', entityType: 'MANAGED_VENUE', entityId: venueId, requestId, metadata: { imageCount: input.items.length } });
      return tx.managedVenue.findUniqueOrThrow({ where: { id: venueId }, include });
    }));
  }

  async addCancellationPolicy(venueId: string, input: VenueCancellationPolicyInput, actorUserId: string, requestId?: string) {
    return venueDto(await serializableTransaction(async (tx) => {
      const from = new Date(input.effectiveFrom); const to = input.effectiveTo ? new Date(input.effectiveTo) : null;
      const overlap = await tx.venueCancellationPolicy.findFirst({ where: { venueId, effectiveFrom: { lt: to ?? new Date('9999-12-31') }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }] } });
      if (overlap) throw new AppError(409, 'That cancellation policy overlaps existing history.', 'VENUE_POLICY_OVERLAP');
      await tx.venueCancellationPolicy.create({ data: { venueId, ...input, effectiveFrom: from, effectiveTo: to } });
      await tx.managedVenue.update({ where: { id: venueId }, data: { publicationStatus: 'DRAFT', submittedByUserId: null, submittedAt: null, approvedByUserId: null, approvedAt: null } });
      await appendAdminAudit(tx, { actorUserId, action: 'VENUE_CANCELLATION_POLICY_CREATED', entityType: 'MANAGED_VENUE', entityId: venueId, requestId });
      return tx.managedVenue.findUniqueOrThrow({ where: { id: venueId }, include });
    }));
  }

  async submitForApproval(venueId: string, actorUserId: string, requestId?: string) {
    return venueDto(await serializableTransaction(async (tx) => {
      const venue = await tx.managedVenue.findUniqueOrThrow({ where: { id: venueId }, include });
      const issues = venueCompletenessIssues(venue);
      if (issues.length) throw new AppError(409, 'Complete every required venue fact before submission.', 'VENUE_INCOMPLETE', { missing: issues });
      const updated = await tx.managedVenue.update({ where: { id: venueId }, data: { publicationStatus: 'PENDING_APPROVAL', submittedByUserId: actorUserId, submittedAt: new Date(), approvedByUserId: null, approvedAt: null }, include });
      await appendAdminAudit(tx, { actorUserId, action: 'VENUE_SUBMITTED', entityType: 'MANAGED_VENUE', entityId: venueId, requestId });
      return updated;
    }));
  }

  async approve(venueId: string, actorUserId: string, requestId?: string) {
    return venueDto(await serializableTransaction(async (tx) => {
      const venue = await tx.managedVenue.findUniqueOrThrow({ where: { id: venueId }, include });
      if (venue.publicationStatus !== 'PENDING_APPROVAL') throw new AppError(409, 'Submit the completed venue before approval.', 'VENUE_NOT_PENDING');
      assertIndependentVenueApprover(venue.submittedByUserId, actorUserId);
      const issues = venueCompletenessIssues(venue);
      if (issues.length) throw new AppError(409, 'Venue facts are no longer complete.', 'VENUE_INCOMPLETE', { missing: issues });
      const updated = await tx.managedVenue.update({ where: { id: venueId }, data: { publicationStatus: 'PUBLISHED', approvedByUserId: actorUserId, approvedAt: new Date(), isActive: true }, include });
      await appendAdminAudit(tx, { actorUserId, action: 'VENUE_PUBLISHED', entityType: 'MANAGED_VENUE', entityId: venueId, requestId });
      return updated;
    }));
  }

  async deactivate(venueId: string, reason: string, actorUserId: string, requestId?: string) {
    return venueDto(await serializableTransaction(async (tx) => {
      const updated = await tx.managedVenue.update({ where: { id: venueId }, data: { publicationStatus: 'DEACTIVATED', isActive: false, deactivatedByUserId: actorUserId, deactivatedAt: new Date(), deactivationReason: reason }, include });
      await appendAdminAudit(tx, { actorUserId, action: 'VENUE_EMERGENCY_DEACTIVATED', entityType: 'MANAGED_VENUE', entityId: venueId, requestId, metadata: { reason } });
      return updated;
    }));
  }
}

export const venueCompletenessIssues = (venue: CatalogVenue) => {
  const now = new Date(); const missing: string[] = [];
  if (!venue.publicDescription || venue.publicDescription.length < 20) missing.push('PUBLIC_DESCRIPTION');
  if (venue.latitude === null || venue.longitude === null) missing.push('COORDINATES');
  if (!venue.coverImageUrl || !venue.coverImageAlt || !venue.coverImageAttribution) missing.push('COVER_IMAGE');
  if (venue.media.length < 3) missing.push('GALLERY_IMAGES');
  if (!venue.amenities.length) missing.push('AMENITIES');
  if (!venue.fields.length) missing.push('FIELDS');
  for (const field of venue.fields) {
    if (!field.supportedFormats.length) missing.push(`FIELD_FORMATS:${field.id}`);
    if (!field.availabilityPeriods.length) missing.push(`FIELD_AVAILABILITY:${field.id}`);
    for (const { format } of field.supportedFormats)
      if (!field.prices.some((price) =>
        (!price.format || price.format === format) &&
        price.effectiveFrom <= now &&
        (!price.effectiveTo || price.effectiveTo > now),
      )) missing.push(`FIELD_PRICE:${field.id}:${format}`);
  }
  if (!venue.cancellationPolicies.some((policy) => policy.effectiveFrom <= now && (!policy.effectiveTo || policy.effectiveTo > now))) missing.push('CANCELLATION_POLICY');
  return missing;
};

export const assertIndependentVenueApprover = (
  submittedByUserId: string | null,
  approverUserId: string,
) => {
  if (submittedByUserId === approverUserId)
    throw new AppError(
      403,
      'A different MFA-verified administrator must approve publication.',
      'VENUE_DUAL_CONTROL_REQUIRED',
    );
};

export const markVenueDraft = (tx: Prisma.TransactionClient, venueId: string) => tx.managedVenue.update({
  where: { id: venueId },
  data: { publicationStatus: 'DRAFT', submittedByUserId: null, submittedAt: null, approvedByUserId: null, approvedAt: null },
});
