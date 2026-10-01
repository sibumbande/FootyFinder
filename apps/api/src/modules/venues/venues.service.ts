import type { MatchFormat, PublicVenueCard, PublicVenueDetail, VenueAvailabilitySlot, VenueSlotsQuery } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../errors/app-error.js';

const venueInclude = {
  media: { orderBy: { sortOrder: 'asc' as const } },
  fields: {
    where: { status: 'ACTIVE' as const },
    include: {
      supportedFormats: true,
      prices: { orderBy: { amountCents: 'asc' as const } },
      availabilityPeriods: true,
      exceptions: true,
    },
    orderBy: { name: 'asc' as const },
  },
} as const;

type VenueRow = Awaited<ReturnType<typeof loadPublishedVenue>>;
const publishedWhere = { publicationStatus: 'PUBLISHED' as const, isActive: true };
const loadPublishedVenue = (where: { slug: string } | { id: string }) =>
  prisma.managedVenue.findFirst({ where: { ...where, ...publishedWhere }, include: venueInclude });

const dateParts = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: Number(value('year')), month: Number(value('month')), day: Number(value('day')),
    weekday: ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as const)[value('weekday') as 'Sun'],
    hour: Number(value('hour')), minute: Number(value('minute')),
  };
};

export const zonedLocalToUtc = (localDate: string, minuteOfDay: number, timezone: string) => {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  const hour = Math.floor(minuteOfDay / 60); const minute = minuteOfDay % 60;
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let instant = desired;
  for (let pass = 0; pass < 4; pass += 1) {
    const observed = dateParts(new Date(instant), timezone);
    const delta = desired - Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute);
    if (!delta) break;
    instant += delta;
  }
  const final = dateParts(new Date(instant), timezone);
  if (final.year !== year || final.month !== month || final.day !== day || final.hour !== hour || final.minute !== minute) return null;
  return new Date(instant);
};

const isoLocalDate = (date: Date, timezone: string) => {
  const local = dateParts(date, timezone);
  return `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
};
const addLocalDays = (value: string, days: number) => {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};
const applicablePrice = (prices: NonNullable<VenueRow>['fields'][number]['prices'], startsAt: Date, format: MatchFormat, timezone: string) => {
  const local = dateParts(startsAt, timezone); const minute = local.hour * 60 + local.minute;
  return prices
    .filter((price) => price.effectiveFrom <= startsAt && (!price.effectiveTo || price.effectiveTo > startsAt))
    .filter((price) => !price.format || price.format === format)
    .filter((price) => price.dayOfWeek === null || (price.dayOfWeek === local.weekday && price.startMinute! <= minute && price.endMinute! >= minute + 60))
    .sort((a, b) => Number(Boolean(b.format)) - Number(Boolean(a.format)) || Number(b.dayOfWeek !== null) - Number(a.dayOfWeek !== null))[0];
};

// DEC-018: venue costs (ManagedFieldPrice amounts) are admin-only. These public mappers never read
// or emit them; prices are used only internally to decide whether a slot is bookable.
export const toPublicVenueCard = (venue: NonNullable<VenueRow>): PublicVenueCard => {
  const supportedFormats = [...new Set(venue.fields.flatMap((field) => field.supportedFormats.map(({ format }) => format)))];
  return {
    slug: venue.slug, name: venue.name, city: venue.city, region: venue.region,
    coverImage: { url: venue.coverImageUrl!, altText: venue.coverImageAlt!, attribution: venue.coverImageAttribution! },
    supportedFormats,
  };
};

// CEO touch-up batch 2, item 7: the venue's own cancellation policy is an agreement between FootyFinder and the
// venue. It is admin-only and never sent to players or guests (they follow the FootyFinder rules, ToS clause 14).
export const toPublicVenueDetail = (venue: NonNullable<VenueRow>): PublicVenueDetail => {
  return {
    ...toPublicVenueCard(venue), description: venue.publicDescription!, addressLine1: venue.addressLine1,
    ...(venue.addressLine2 ? { addressLine2: venue.addressLine2 } : {}), ...(venue.postalCode ? { postalCode: venue.postalCode } : {}),
    countryCode: venue.countryCode, latitude: Number(venue.latitude), longitude: Number(venue.longitude), timezone: venue.timezone,
    amenities: venue.amenities, gallery: venue.media.map(({ url, thumbUrl, altText, attribution }) => ({ url, ...(thumbUrl ? { thumbUrl } : {}), altText, attribution })),
    fields: venue.fields.map((field) => ({
      id: field.id, name: field.name, ...(field.description ? { description: field.description } : {}),
      supportedFormats: field.supportedFormats.map(({ format }) => format), turnaroundBufferMinutes: field.turnaroundBufferMinutes,
    })),
  };
};

export class VenuesService {
  async list() {
    const venues = await prisma.managedVenue.findMany({ where: publishedWhere, include: venueInclude, orderBy: [{ city: 'asc' }, { name: 'asc' }] });
    return venues.map(toPublicVenueCard);
  }

  async get(slug: string) {
    let venue = await loadPublishedVenue({ slug });
    if (!venue) {
      const alias = await prisma.managedVenueSlugAlias.findUnique({ where: { slug }, select: { venueId: true } });
      if (alias) venue = await loadPublishedVenue({ id: alias.venueId });
    }
    if (!venue) throw new AppError(404, 'Venue not found.', 'VENUE_NOT_FOUND');
    return { venue: toPublicVenueDetail(venue), canonicalSlug: venue.slug, wasAlias: venue.slug !== slug };
  }

  async slots(slug: string, query: VenueSlotsQuery, now = new Date()): Promise<VenueAvailabilitySlot[]> {
    const resolved = await this.get(slug);
    const venue = await loadPublishedVenue({ slug: resolved.canonicalSlug });
    const field = venue!.fields.find(({ id }) => id === query.fieldId);
    if (!field || !field.supportedFormats.some(({ format }) => format === query.format))
      throw new AppError(404, 'Field or format not found.', 'FIELD_NOT_BOOKABLE');
    const today = isoLocalDate(now, venue!.timezone);
    if (query.dateFrom < today || query.dateTo > addLocalDays(today, 60))
      throw new AppError(400, 'Availability is limited to the next 60 days.', 'SLOT_RANGE_INVALID');
    const days = Math.round((Date.parse(`${query.dateTo}T00:00:00Z`) - Date.parse(`${query.dateFrom}T00:00:00Z`)) / 86_400_000) + 1;
    if (days < 1 || days > 31) throw new AppError(400, 'Request at most 31 days at a time.', 'SLOT_RANGE_INVALID');
    const rangeStart = zonedLocalToUtc(query.dateFrom, 0, venue!.timezone)!;
    const rangeEnd = zonedLocalToUtc(addLocalDays(query.dateTo, 1), 0, venue!.timezone)!;
    const reservations = await prisma.fieldReservation.findMany({
      where: { fieldId: field.id, status: { in: ['FUNDING', 'CONFIRMED'] }, startsAt: { lt: rangeEnd }, endsAt: { gt: new Date(rangeStart.getTime() - 4 * 60 * 60_000) } },
      select: { startsAt: true, endsAt: true, turnaroundBufferMinutesSnapshot: true },
    });
    const minimum = new Date(now.getTime() + 2 * 60 * 60_000);
    const slots: VenueAvailabilitySlot[] = [];
    for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
      const localDate = addLocalDays(query.dateFrom, dayIndex);
      for (let minute = 0; minute < 24 * 60; minute += 30) {
        const startsAt = zonedLocalToUtc(localDate, minute, venue!.timezone);
        if (!startsAt || startsAt < minimum) continue;
        const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
        const local = dateParts(startsAt, venue!.timezone);
        const exceptions = field.exceptions.filter((item) => item.startsAt < endsAt && item.endsAt > startsAt);
        const weekly = field.availabilityPeriods.some((item) => item.dayOfWeek === local.weekday && item.startMinute <= minute && item.endMinute >= minute + 60);
        const availableException = exceptions.some((item) => item.available && item.startsAt <= startsAt && item.endsAt >= endsAt);
        if (exceptions.some((item) => !item.available) || (!weekly && !availableException)) continue;
        if (reservations.some((item) => item.startsAt < new Date(endsAt.getTime() + field.turnaroundBufferMinutes * 60_000) && new Date(item.endsAt.getTime() + item.turnaroundBufferMinutesSnapshot * 60_000) > startsAt)) continue;
        const price = applicablePrice(field.prices, startsAt, query.format, venue!.timezone);
        if (!price) continue;
        slots.push({ fieldId: field.id, format: query.format, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), localDate, localTime: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`, timezone: venue!.timezone });
      }
    }
    return slots;
  }
}
