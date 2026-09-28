import { prisma } from '../src/database/prisma.js';

const requiredVenues = ['Queens Park', 'Cape Town City FC', 'Italian Club'] as const;

const venues = await prisma.managedVenue.findMany({
  where: { name: { in: [...requiredVenues] } },
  include: {
    media: true,
    cancellationPolicies: true,
    fields: {
      include: {
        supportedFormats: true,
        availabilityPeriods: true,
        prices: true,
      },
    },
  },
  orderBy: { name: 'asc' },
});

const now = new Date();
const byName = new Map(venues.map((venue) => [venue.name, venue]));
const report = requiredVenues.map((name) => {
  const venue = byName.get(name);
  const issues: string[] = [];
  if (!venue) return { name, status: 'MISSING', issues: ['APPROVED_VENUE_PACK_NOT_LOADED'] };
  if (venue.publicationStatus !== 'PUBLISHED') issues.push('NOT_INDEPENDENTLY_PUBLISHED');
  if (!venue.isActive) issues.push('NOT_ACTIVE');
  if (!venue.publicDescription) issues.push('PUBLIC_DESCRIPTION');
  if (venue.latitude === null || venue.longitude === null) issues.push('COORDINATES');
  if (!venue.coverImageUrl || !venue.coverImageAlt || !venue.coverImageAttribution)
    issues.push('COVER_IMAGE_RIGHTS_AND_ATTRIBUTION');
  if (venue.media.length < 3) issues.push('GALLERY_IMAGES');
  if (!venue.amenities.length) issues.push('AMENITIES');
  if (!venue.cancellationPolicies.some((policy) =>
    policy.effectiveFrom <= now && (!policy.effectiveTo || policy.effectiveTo > now),
  )) issues.push('EFFECTIVE_CANCELLATION_POLICY');
  if (!venue.fields.length) issues.push('FIELDS');
  for (const field of venue.fields) {
    if (!field.supportedFormats.length) issues.push(`FIELD_FORMATS:${field.name}`);
    if (!field.availabilityPeriods.length) issues.push(`FIELD_AVAILABILITY:${field.name}`);
    if (field.turnaroundBufferMinutes < 15) issues.push(`FIELD_BUFFER:${field.name}`);
    for (const { format } of field.supportedFormats)
      if (!field.prices.some((price) =>
        (!price.format || price.format === format) &&
        price.effectiveFrom <= now &&
        (!price.effectiveTo || price.effectiveTo > now),
      )) issues.push(`EFFECTIVE_PRICE:${field.name}:${format}`);
  }
  return { name, status: venue.publicationStatus, slug: venue.slug, issues };
});

console.log(JSON.stringify({ checkedAt: now.toISOString(), requiredVenues: report }, null, 2));
await prisma.$disconnect();

if (report.some((venue) => venue.issues.length)) {
  console.error('Gate 3 production venue data is not release-ready. Load verified packs through dual control.');
  process.exitCode = 2;
}
