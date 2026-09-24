import type {
  BookingContributionInput,
  FieldBooking,
  ManagedMatchBookingInput,
  PlayerFieldBookingInput,
} from '@footy-finder/shared';
import { createDefaultFormation } from '@footy-finder/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { AdminCatalogService } from '../admin/admin-catalog.service.js';
import { matchInclude } from '../matches/match.query.js';
import { toMatch } from '../matches/match.mapper.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { toPublicUser } from '../users/user.mapper.js';
import { FinancialInsufficientFundsError, FinancialRepository } from '../wallet/financial.repository.js';

const durations = {
  FIVE_A_SIDE: env.MATCH_DURATION_FIVE_A_SIDE_MINUTES,
  SEVEN_A_SIDE: env.MATCH_DURATION_SEVEN_A_SIDE_MINUTES,
  ELEVEN_A_SIDE: env.MATCH_DURATION_ELEVEN_A_SIDE_MINUTES,
} as const;
const bookingInclude = {
  match: { include: matchInclude },
  obligations: {
    include: {
      contributions: {
        include: { user: { include: { profile: { include: { preferredPositions: true } } } } },
        orderBy: { createdAt: 'asc' as const },
      },
    },
  },
} as const;
const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as const;
const localParts = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return { day: weekdayIndex[get('weekday') as keyof typeof weekdayIndex], minute: Number(get('hour')) * 60 + Number(get('minute')) };
};
export const isWithinFieldAvailability = (
  field: { venue: { timezone: string }; availabilityPeriods: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>; exceptions: Array<{ startsAt: Date; endsAt: Date; available: boolean }> },
  startsAt: Date,
  endsAt: Date,
) => {
  const overlappingExceptions = field.exceptions.filter((item) => item.startsAt < endsAt && item.endsAt > startsAt);
  if (overlappingExceptions.some((item) => !item.available)) return false;
  if (overlappingExceptions.some((item) => item.available && item.startsAt <= startsAt && item.endsAt >= endsAt)) return true;
  const start = localParts(startsAt, field.venue.timezone);
  const end = localParts(endsAt, field.venue.timezone);
  return start.day === end.day && field.availabilityPeriods.some((period) => period.dayOfWeek === start.day && period.startMinute <= start.minute && period.endMinute >= end.minute);
};

const bookingDto = (reservation: any, viewerId?: string): FieldBooking => {
  const contributions = reservation.obligations.flatMap((item: any) => item.contributions);
  const fundedCents = contributions.filter((item: any) => item.status !== 'RELEASED').reduce((sum: number, item: any) => sum + item.amountCents, 0);
  return {
    id: reservation.id, source: reservation.source, status: reservation.status,
    startsAt: reservation.startsAt.toISOString(), endsAt: reservation.endsAt.toISOString(),
    ...(reservation.fundingDeadline ? { fundingDeadline: reservation.fundingDeadline.toISOString() } : {}),
    priceCents: reservation.priceCentsSnapshot, fundedCents,
    remainingCents: Math.max(0, reservation.priceCentsSnapshot - fundedCents), currency: 'ZAR',
    venueName: reservation.venueNameSnapshot, fieldName: reservation.fieldNameSnapshot,
    address: reservation.addressSnapshot, city: reservation.citySnapshot,
    match: toMatch(reservation.match, { viewerCanManage: reservation.match.createdById === viewerId, viewerCanChat: reservation.match.createdById === viewerId }),
    contributions: contributions.map((item: any) => ({ id: item.id, amountCents: item.amountCents, status: item.status, createdAt: item.createdAt.toISOString(), user: toPublicUser(item.user) })),
    createdAt: reservation.createdAt.toISOString(),
  };
};

export class BookingsService {
  constructor(
    private readonly financial = new FinancialRepository(),
    private readonly notifications = new NotificationsService(),
  ) {}

  async listBookableFields() {
    return (await new AdminCatalogService().list())
      .filter((venue) => venue.isActive)
      .map((venue) => ({
        ...venue,
        fields: venue.fields.filter((field) => field.status === 'ACTIVE'),
      }))
      .filter((venue) => venue.fields.length > 0);
  }

  private async fieldContext(tx: Prisma.TransactionClient, fieldId: string, format: ManagedMatchBookingInput['format'], startsAt: Date) {
    const endsAt = new Date(startsAt.getTime() + durations[format] * 60_000);
    const field = await tx.managedField.findUnique({
      where: { id: fieldId },
      include: { venue: true, supportedFormats: true, availabilityPeriods: true, exceptions: { where: { startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } }, prices: { where: { effectiveFrom: { lte: startsAt }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: startsAt } }] } } },
    });
    if (!field || !field.venue.isActive || field.status !== 'ACTIVE') throw new AppError(409, 'That field is not bookable.', 'FIELD_NOT_BOOKABLE');
    if (!field.supportedFormats.some((item) => item.format === format)) throw new AppError(409, 'That field does not support this format.', 'FIELD_FORMAT_UNSUPPORTED');
    if (!isWithinFieldAvailability(field, startsAt, endsAt)) throw new AppError(409, 'That time is outside field availability.', 'FIELD_UNAVAILABLE');
    const price = field.prices[0];
    if (!price) throw new AppError(409, 'No effective price is configured for that time.', 'FIELD_PRICE_UNAVAILABLE');
    return { field, price, endsAt };
  }

  private async createReservation(input: ManagedMatchBookingInput, actorUserId: string, source: 'ADMIN_LOADED' | 'PLAYER_BOOKING', requestId?: string) {
    const startsAt = new Date(input.startsAt);
    if (startsAt <= new Date()) throw new AppError(400, 'Choose a future booking time.', 'MATCH_START_TIME_INVALID');
    try {
      const reservation = await serializableTransaction(async (tx) => {
        const { field, price, endsAt } = await this.fieldContext(tx, input.managedFieldId, input.format, startsAt);
        const now = new Date();
        const requiresFunding = source === 'PLAYER_BOOKING' && price.amountCents > 0;
        const fundingDeadline = requiresFunding ? new Date(now.getTime() + env.BOOKING_FUNDING_MINUTES * 60_000) : null;
        if (fundingDeadline && fundingDeadline >= startsAt) throw new AppError(409, 'The booking starts before its funding window can complete.', 'BOOKING_FUNDING_WINDOW_INVALID');
        const address = [field.venue.addressLine1, field.venue.addressLine2].filter(Boolean).join(', ');
        const match = await tx.match.create({ data: {
          name: input.name, description: input.description, createdBy: { connect: { id: actorUserId } },
          mode: 'QUICK_GAME', format: input.format, substituteCapacityPerTeam: input.substituteCapacityPerTeam,
          rollingSubstitutes: input.rollingSubstitutes, rules: input.rules,
          visibility: input.visibility, startsAt, durationMinutes: durations[input.format], feeCents: 0,
          status: source === 'ADMIN_LOADED' ? 'OPEN' : 'DRAFT',
          venue: { create: { name: `${field.venue.name} — ${field.name}`, addressLine1: field.venue.addressLine1, addressLine2: field.venue.addressLine2, city: field.venue.city, region: field.venue.region, postalCode: field.venue.postalCode, countryCode: field.venue.countryCode, latitude: field.venue.latitude, longitude: field.venue.longitude } },
          formationSlots: { create: createDefaultFormation(input.format) },
        } });
        const confirmed = !requiresFunding;
        const created = await tx.fieldReservation.create({
          data: {
            fieldId: field.id, fieldPriceId: price.id, matchId: match.id, source,
            status: confirmed ? 'CONFIRMED' : 'FUNDING', startsAt, endsAt,
            fundingDeadline, priceCentsSnapshot: price.amountCents, currencySnapshot: price.currency,
            venueNameSnapshot: field.venue.name, fieldNameSnapshot: field.name, addressSnapshot: address,
            citySnapshot: field.venue.city, desiredVisibility: input.visibility,
            confirmedAt: confirmed ? now : null,
            obligations: { create: { obligationKey: confirmed ? 'PLATFORM' : 'PLAYER_POOL', requiredCents: price.amountCents, status: confirmed ? 'CAPTURED' : 'PENDING', capturedAt: confirmed ? now : null } },
          },
        });
        if (fundingDeadline) await enqueueDurableJob(tx, { type: 'RESERVATION_FUNDING_EXPIRE', dedupeKey: `reservation-expire:${created.id}`, payload: { reservationId: created.id }, runAt: fundingDeadline });
        if (source === 'ADMIN_LOADED') await appendAdminAudit(tx, { actorUserId, action: 'MATCH_LOADED', entityType: 'FIELD_RESERVATION', entityId: created.id, requestId, metadata: { matchId: match.id, fieldId: field.id, priceCents: price.amountCents } });
        return tx.fieldReservation.findUniqueOrThrow({ where: { id: created.id }, include: bookingInclude });
      });
      return bookingDto(reservation, actorUserId);
    } catch (error) {
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2004' &&
          String(error.meta?.database_error).includes('FieldReservation_no_overlap')) ||
        String(error).includes('FieldReservation_no_overlap')
      )
        throw new AppError(409, 'That field is already reserved for this time.', 'FIELD_TIME_CONFLICT');
      throw error;
    }
  }

  createAdmin(input: ManagedMatchBookingInput, adminUserId: string, requestId?: string) { return this.createReservation(input, adminUserId, 'ADMIN_LOADED', requestId); }
  createPlayer(input: PlayerFieldBookingInput, userId: string) { return this.createReservation(input, userId, 'PLAYER_BOOKING'); }

  async listAdmin() { return (await prisma.fieldReservation.findMany({ include: bookingInclude, orderBy: { startsAt: 'asc' }, take: 200 })).map((item) => bookingDto(item)); }
  async listMine(userId: string) { return (await prisma.fieldReservation.findMany({ where: { OR: [{ match: { createdById: userId } }, { obligations: { some: { contributions: { some: { userId } } } } }] }, include: bookingInclude, orderBy: { startsAt: 'asc' }, take: 100 })).map((item) => bookingDto(item, userId)); }
  async get(id: string, userId: string) {
    const item = await prisma.fieldReservation.findUnique({ where: { id }, include: bookingInclude });
    if (!item || (item.match.visibility === 'PRIVATE' && item.match.createdById !== userId && !item.obligations.some((obligation) => obligation.contributions.some((contribution) => contribution.userId === userId)))) throw new AppError(404, 'Booking not found.', 'BOOKING_NOT_FOUND');
    return bookingDto(item, userId);
  }

  async contribute(id: string, userId: string, input: BookingContributionInput, idempotencyKey: string) {
    if (!idempotencyKey || idempotencyKey.length > 200) throw new AppError(400, 'A valid Idempotency-Key header is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    let published: any[] = [];
    try {
      const reservation = await serializableTransaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "FieldReservation" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const current = await tx.fieldReservation.findUnique({ where: { id }, include: bookingInclude });
        if (!current || (current.match.visibility === 'PRIVATE' && current.match.createdById !== userId)) throw new AppError(404, 'Booking not found.', 'BOOKING_NOT_FOUND');
        const obligation = current.obligations[0]!;
        const replay = obligation.contributions.find((item) => item.idempotencyKey === idempotencyKey);
        if (replay) {
          if (replay.userId !== userId || replay.amountCents !== input.amountCents) throw new AppError(409, 'That contribution key was already used.', 'FINANCIAL_IDEMPOTENCY_CONFLICT');
          return current;
        }
        if (current.status !== 'FUNDING' || !current.fundingDeadline || current.fundingDeadline <= new Date()) throw new AppError(409, 'This booking is no longer accepting funding.', 'BOOKING_FUNDING_CLOSED');
        const heldCents = obligation.contributions.filter((item) => item.status === 'HELD').reduce((sum, item) => sum + item.amountCents, 0);
        if (input.amountCents > obligation.requiredCents - heldCents) throw new AppError(409, 'Contribution exceeds the remaining amount.', 'FUNDING_AMOUNT_EXCEEDS_REMAINING');
        let hold;
        try { hold = (await this.financial.createHold(tx, { userId, amountCents: input.amountCents, idempotencyKey: `booking-contribution:${idempotencyKey}`, referenceType: 'FIELD_RESERVATION', referenceId: id, description: 'Field booking funding contribution', expiresAt: current.fundingDeadline })).hold; }
        catch (error) { if (error instanceof FinancialInsufficientFundsError) throw new AppError(402, 'Your available wallet balance is too low.', 'INSUFFICIENT_BALANCE'); throw error; }
        await tx.fundingContribution.create({ data: { obligationId: obligation.id, userId, walletHoldId: hold.id, amountCents: input.amountCents, idempotencyKey } });
        if (heldCents + input.amountCents === obligation.requiredCents) {
          const all = await tx.fundingContribution.findMany({ where: { obligationId: obligation.id, status: 'HELD' }, orderBy: { createdAt: 'asc' } });
          for (const contribution of all) {
            await this.financial.captureHold(tx, contribution.walletHoldId, { type: 'FIELD_BOOKING_DEBIT', idempotencyKey: `booking-capture:${contribution.id}`, description: 'Captured field booking contribution' });
            await tx.fundingContribution.update({ where: { id: contribution.id }, data: { status: 'CAPTURED', capturedAt: new Date() } });
          }
          await tx.fundingObligation.update({ where: { id: obligation.id }, data: { status: 'CAPTURED', capturedAt: new Date() } });
          await tx.fieldReservation.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
          await tx.match.update({ where: { id: current.matchId }, data: { status: 'OPEN', visibility: current.desiredVisibility } });
          const recipients = [...new Set(all.map((item) => item.userId))];
          published = await persistNotifications(tx, recipients.map((recipientId) => ({ userId: recipientId, type: 'BOOKING_CONFIRMED' as const, title: 'Field booking confirmed', message: `${current.venueNameSnapshot} — ${current.fieldNameSnapshot} is fully funded.`, targetPath: `/bookings/${id}`, dedupeKey: notificationDedupeKey('booking', id, 'confirmed', recipientId) })));
        }
        return tx.fieldReservation.findUniqueOrThrow({ where: { id }, include: bookingInclude });
      });
      this.notifications.publishPersistedMany(published);
      return bookingDto(reservation, userId);
    } catch (error) {
      throw error;
    }
  }

  async expire(id: string) {
    const result = await serializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "FieldReservation" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const current = await tx.fieldReservation.findUnique({ where: { id }, include: bookingInclude });
      if (!current || current.status !== 'FUNDING') return { reservation: current, notifications: [] };
      const contributions = current.obligations.flatMap((item) => item.contributions).filter((item) => item.status === 'HELD');
      for (const contribution of contributions) {
        await this.financial.releaseHold(tx, contribution.walletHoldId, true);
        await tx.fundingContribution.update({ where: { id: contribution.id }, data: { status: 'RELEASED', releasedAt: new Date() } });
      }
      await tx.fundingObligation.updateMany({ where: { reservationId: id }, data: { status: 'RELEASED' } });
      await tx.fieldReservation.update({ where: { id }, data: { status: 'EXPIRED', cancelledAt: new Date() } });
      await tx.match.update({ where: { id: current.matchId }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
      const notifications = await persistNotifications(tx, [...new Set(contributions.map((item) => item.userId))].map((recipientId) => ({ userId: recipientId, type: 'BOOKING_EXPIRED' as const, title: 'Booking funding expired', message: 'The field was released and your wallet hold was removed.', targetPath: `/bookings/${id}`, dedupeKey: notificationDedupeKey('booking', id, 'expired', recipientId) })));
      return { reservation: await tx.fieldReservation.findUniqueOrThrow({ where: { id }, include: bookingInclude }), notifications };
    });
    this.notifications.publishPersistedMany(result.notifications);
    return result.reservation ? bookingDto(result.reservation) : null;
  }
}
