import type {
  AdminCreatedMatch,
  AdminFieldBooking,
  FieldBooking,
  ManagedMatchBookingInput,
  CreateMatchInput,
  adminCreateMatchSchema,
} from '@footy-finder/shared';
import type { z } from 'zod';
import { createDefaultFormation, getGoNoGoAt, MATCH_DURATION_MINUTES, MATCH_FEE_CENTS } from '@footy-finder/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { matchInclude } from '../matches/match.query.js';
import { toMatch } from '../matches/match.mapper.js';
import { enqueueGoNoGoJob } from '../matches/go-no-go.js';
import { onRefereedMatchPublished } from '../referees/referee-assignment.js';
import { enqueueFillReminderJob } from '../matches/fill-reminder.js';
import { toPublicUser } from '../users/user.mapper.js';
import { createMatchInviteToken, hashMatchInviteToken } from '../matches/invite-token.js';
import { createPublicMatchSlug, publicMatchUrl } from '../matches/public-match.js';
import { activeClosures, overlapsClosure } from '../venues/field-closures.js';

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

/** ADMIN-ONLY: includes the venue cost snapshot and funding totals. Never returned to players or hosts. */
export const adminBookingDto = (reservation: any, viewerId?: string): AdminFieldBooking => {
  const contributions = reservation.obligations.flatMap((item: any) => item.contributions);
  const fundedCents = contributions.filter((item: any) => item.status !== 'RELEASED').reduce((sum: number, item: any) => sum + item.amountCents, 0);
  return {
    ...playerBookingDto(reservation, viewerId),
    priceCents: reservation.priceCentsSnapshot, fundedCents,
    remainingCents: Math.max(0, reservation.priceCentsSnapshot - fundedCents), currency: 'ZAR',
    contributions: contributions.map((item: any) => ({ id: item.id, amountCents: item.amountCents, status: item.status, createdAt: item.createdAt.toISOString(), user: toPublicUser(item.user) })),
  };
};

/**
 * Player/host booking history (DEC-018): no venue cost, no funding totals, no contribution
 * amounts. Built field by field so a new admin-only column can never leak through a spread.
 */
export const playerBookingDto = (reservation: any, viewerId?: string): FieldBooking => ({
  id: reservation.id, source: reservation.source, status: reservation.status,
  startsAt: reservation.startsAt.toISOString(), endsAt: reservation.endsAt.toISOString(),
  ...(reservation.fundingDeadline ? { fundingDeadline: reservation.fundingDeadline.toISOString() } : {}),
  venueName: reservation.venueNameSnapshot, fieldName: reservation.fieldNameSnapshot,
  address: reservation.addressSnapshot, city: reservation.citySnapshot,
  match: toMatch(reservation.match, { viewerCanManage: reservation.match.createdById === viewerId, viewerCanChat: reservation.match.createdById === viewerId }),
  contributions: reservation.obligations
    .flatMap((item: any) => item.contributions)
    .map((item: any) => ({ id: item.id, status: item.status, createdAt: item.createdAt.toISOString(), user: toPublicUser(item.user) })),
  createdAt: reservation.createdAt.toISOString(),
});

/** CEO touch-up batch 3.5, item 5: the web page a private match's invite link opens. */
export const matchInviteUrl = (token: string) => new URL(`/matches/invite/${token}`, env.CLIENT_URL).toString();

/** A player-created managed slot must be two hours to 60 days away. */
export const assertPlayerSlotWindow = (startsAt: Date, now: Date) => {
  if (startsAt.getTime() < now.getTime() + 2 * 60 * 60_000 || startsAt.getTime() > now.getTime() + 60 * 86_400_000)
    throw new AppError(400, 'Choose a calculated slot between two hours and 60 days from now.', 'MATCH_START_TIME_INVALID');
};

/** Maps the reservation exclusion constraint to a stable conflict. */
export const rethrowReservationConflict = (error: unknown): never => {
  if ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2004' && String(error.meta?.database_error).includes('FieldReservation_no_overlap')) || String(error).includes('FieldReservation_no_overlap'))
    throw new AppError(409, 'That field is already reserved for this slot.', 'FIELD_TIME_CONFLICT');
  throw error;
};

export class BookingsService {
  private async fieldContext(tx: Prisma.TransactionClient, fieldId: string, format: ManagedMatchBookingInput['format'], startsAt: Date) {
    const endsAt = new Date(startsAt.getTime() + MATCH_DURATION_MINUTES * 60_000);
    const field = await tx.managedField.findUnique({
      where: { id: fieldId },
      include: { venue: { include: { cancellationPolicies: { where: { effectiveFrom: { lte: startsAt }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: startsAt } }] }, orderBy: { effectiveFrom: 'desc' } } } }, supportedFormats: true, availabilityPeriods: true, exceptions: { where: { startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } }, closures: activeClosures, prices: { where: { effectiveFrom: { lte: startsAt }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: startsAt } }] } } },
    });
    if (!field || !field.venue.isActive || field.venue.publicationStatus !== 'PUBLISHED' || field.status !== 'ACTIVE') throw new AppError(409, 'That field is not bookable.', 'FIELD_NOT_BOOKABLE');
    if (!field.supportedFormats.some((item) => item.format === format)) throw new AppError(409, 'That field does not support this format.', 'FIELD_FORMAT_UNSUPPORTED');
    if (!isWithinFieldAvailability(field, startsAt, endsAt)) throw new AppError(409, 'That time is outside field availability.', 'FIELD_UNAVAILABLE');
    // CEO touch-up batch 3, item 3: a closed time can never be booked.
    if (overlapsClosure(field.closures, startsAt, endsAt, field.venue.timezone)) throw new AppError(409, 'The field is closed at that time. Choose another slot.', 'FIELD_CLOSED');
    const local = localParts(startsAt, field.venue.timezone);
    const price = field.prices
      .filter((item) => !item.format || item.format === format)
      .filter((item) => item.dayOfWeek === null || (item.dayOfWeek === local.day && item.startMinute! <= local.minute && item.endMinute! >= local.minute + MATCH_DURATION_MINUTES))
      .sort((a, b) => Number(Boolean(b.format)) - Number(Boolean(a.format)) || Number(b.dayOfWeek !== null) - Number(a.dayOfWeek !== null))[0];
    if (!price) throw new AppError(409, 'No effective price is configured for that time.', 'FIELD_PRICE_UNAVAILABLE');
    const cancellationPolicy = field.venue.cancellationPolicies[0];
    if (!cancellationPolicy) throw new AppError(409, 'No effective cancellation policy is configured.', 'VENUE_POLICY_UNAVAILABLE');
    return { field, price, cancellationPolicy, endsAt };
  }

  /**
   * A bookable player slot on the 30-minute grid, with the Venue snapshot for the match and the
   * reservation data (including the admin-only price snapshot). Shared by Quick Matches and
   * Gate 7 team matches so both reserve fields exactly the same way.
   */
  async playerSlot(tx: Prisma.TransactionClient, fieldId: string, format: ManagedMatchBookingInput['format'], startsAt: Date) {
    const { field, price, cancellationPolicy, endsAt } = await this.fieldContext(tx, fieldId, format, startsAt);
    const local = localParts(startsAt, field.venue.timezone);
    if (local.minute % 30 !== 0) throw new AppError(409, 'Choose a server-calculated 30-minute-grid slot.', 'FIELD_SLOT_INVALID');
    const address = [field.venue.addressLine1, field.venue.addressLine2].filter(Boolean).join(', ');
    return {
      venue: { name: `${field.venue.name} — ${field.name}`, addressLine1: field.venue.addressLine1, addressLine2: field.venue.addressLine2, city: field.venue.city, region: field.venue.region, postalCode: field.venue.postalCode, countryCode: field.venue.countryCode, latitude: field.venue.latitude, longitude: field.venue.longitude },
      reservation: (matchId: string, visibility: 'PUBLIC' | 'PRIVATE', now: Date) => ({
        fieldId: field.id, fieldPriceId: price.id, cancellationPolicyId: cancellationPolicy.id, matchId,
        source: 'PLAYER_BOOKING' as const, status: 'CONFIRMED' as const, startsAt, endsAt, priceCentsSnapshot: price.amountCents,
        venueNameSnapshot: field.venue.name, fieldNameSnapshot: field.name, addressSnapshot: address, citySnapshot: field.venue.city,
        timezoneSnapshot: field.venue.timezone, turnaroundBufferMinutesSnapshot: field.turnaroundBufferMinutes,
        cancellationPolicySnapshot: { fullCreditBeforeHours: cancellationPolicy.fullCreditBeforeHours, lateCreditPercent: cancellationPolicy.lateCreditPercent, venueCancellationPercent: cancellationPolicy.venueCancellationPercent, policyText: cancellationPolicy.policyText },
        organizerGuaranteeCents: 0,
        desiredVisibility: visibility, confirmedAt: now,
      }),
    };
  }

  async createQuickMatch(input: CreateMatchInput, actorUserId: string) {
    const startsAt = new Date(input.startsAt); const now = new Date();
    assertPlayerSlotWindow(startsAt, now);
    const inviteToken = input.visibility === 'PRIVATE' ? createMatchInviteToken() : undefined;
    try {
      const match = await serializableTransaction(async (tx) => {
        const slot = await this.playerSlot(tx, input.managedFieldId, input.format, startsAt);
        const created = await tx.match.create({ data: {
          name: input.name, description: input.description, createdBy: { connect: { id: actorUserId } }, mode: 'QUICK_GAME', format: input.format,
          substituteCapacityPerTeam: input.substituteCapacityPerTeam, rollingSubstitutes: input.rollingSubstitutes, rules: input.rules,
          visibility: input.visibility,
          girlsOnly: input.girlsOnly ?? false,
          publicSlug: input.visibility === 'PUBLIC' ? createPublicMatchSlug() : undefined,
          inviteTokenHash: inviteToken ? hashMatchInviteToken(inviteToken) : undefined,
          // DEC-018: the platform sets the fee; hosts never choose it.
          startsAt, durationMinutes: MATCH_DURATION_MINUTES, feeCents: MATCH_FEE_CENTS, status: 'OPEN',
          goNoGoAt: getGoNoGoAt(startsAt),
          venue: { create: slot.venue },
          formationSlots: { create: createDefaultFormation(input.format) },
        } });
        // DEC-018: no host guarantee. The host places no wallet hold and owes nothing for the venue;
        // they pay the fixed fee only if they join a team like any other player.
        await tx.fieldReservation.create({ data: slot.reservation(created.id, input.visibility, now) });
        await enqueueGoNoGoJob(tx, created.id, startsAt);
        await enqueueFillReminderJob(tx, created.id, startsAt, now);
        // Gate 8 / DEC-020: every match needs a FootyFinder referee (default referee, D28).
        await onRefereedMatchPublished(tx, created, now);
        return tx.match.findUniqueOrThrow({ where: { id: created.id }, include: matchInclude });
      });
      return toMatch(match, { inviteToken, viewerCanManage: true, viewerCanChat: true });
    } catch (error) {
      return rethrowReservationConflict(error);
    }
  }

  /**
   * CEO touch-up batch 3.5, item 5 (D3, D4): an admin creates a Quick Match that FootyFinder hosts. It is booked
   * exactly like a player-created match: 2 hours to 60 days ahead on the 30-minute grid, the field's availability,
   * closures, price and policy, and the same reservation the venue payable is created from at kick-off. The admin
   * does not join. It can be free "On FootyFinder" (optionally first-time players only) from the start.
   */
  async createAdminMatch(input: z.output<typeof adminCreateMatchSchema>, adminUserId: string, requestId?: string): Promise<AdminCreatedMatch> {
    const startsAt = new Date(input.startsAt);
    const now = new Date();
    assertPlayerSlotWindow(startsAt, now);
    const inviteToken = input.visibility === 'PRIVATE' ? createMatchInviteToken() : undefined;
    const free = input.freeOnFootyFinder;
    const firstTimersOnly = free && input.firstTimersOnly;
    try {
      const match = await serializableTransaction(async (tx) => {
        const slot = await this.playerSlot(tx, input.managedFieldId, input.format, startsAt);
        const created = await tx.match.create({ data: {
          name: input.name, description: input.description, createdBy: { connect: { id: adminUserId } }, mode: 'QUICK_GAME', format: input.format,
          substituteCapacityPerTeam: input.substituteCapacityPerTeam, rollingSubstitutes: input.rollingSubstitutes, rules: input.rules,
          visibility: input.visibility,
          publicSlug: input.visibility === 'PUBLIC' ? createPublicMatchSlug() : undefined,
          inviteTokenHash: inviteToken ? hashMatchInviteToken(inviteToken) : undefined,
          startsAt, durationMinutes: MATCH_DURATION_MINUTES, feeCents: free ? 0 : MATCH_FEE_CENTS,
          freeOnFootyFinder: free, firstTimersOnly, hostedByFootyFinder: true, girlsOnly: input.girlsOnly ?? false,
          status: 'OPEN', goNoGoAt: getGoNoGoAt(startsAt),
          venue: { create: slot.venue },
          formationSlots: { create: createDefaultFormation(input.format) },
        } });
        const reservation = await tx.fieldReservation.create({ data: { ...slot.reservation(created.id, input.visibility, now), source: 'ADMIN_LOADED' } });
        await enqueueGoNoGoJob(tx, created.id, startsAt);
        await enqueueFillReminderJob(tx, created.id, startsAt, now);
        await onRefereedMatchPublished(tx, created, now);
        await appendAdminAudit(tx, {
          actorUserId: adminUserId, action: 'MATCH_LOADED', entityType: 'FIELD_RESERVATION', entityId: reservation.id, requestId,
          metadata: { matchId: created.id, fieldId: input.managedFieldId, priceCents: reservation.priceCentsSnapshot, visibility: input.visibility, freeOnFootyFinder: free, firstTimersOnly, hostedByFootyFinder: true, girlsOnly: input.girlsOnly ?? false },
        });
        return created;
      });
      return {
        matchId: match.id, name: match.name, startsAt: match.startsAt.toISOString(), visibility: match.visibility,
        freeOnFootyFinder: free, firstTimersOnly,
        ...(match.publicSlug ? { publicUrl: publicMatchUrl(match.publicSlug) } : {}),
        ...(inviteToken ? { inviteUrl: matchInviteUrl(inviteToken) } : {}),
      };
    } catch (error) {
      return rethrowReservationConflict(error);
    }
  }

  async listMine(userId: string) { return (await prisma.fieldReservation.findMany({ where: { OR: [{ match: { createdById: userId } }, { obligations: { some: { contributions: { some: { userId } } } } }] }, include: bookingInclude, orderBy: { startsAt: 'asc' }, take: 100 })).map((item) => playerBookingDto(item, userId)); }
  async get(id: string, userId: string) {
    const item = await prisma.fieldReservation.findUnique({ where: { id }, include: bookingInclude });
    if (!item || (item.match.visibility === 'PRIVATE' && item.match.createdById !== userId && !item.obligations.some((obligation) => obligation.contributions.some((contribution) => contribution.userId === userId)))) throw new AppError(404, 'Booking not found.', 'BOOKING_NOT_FOUND');
    return playerBookingDto(item, userId);
  }
}
