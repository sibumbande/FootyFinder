import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/database/prisma.js';
import { LocalFileStorage } from '../../src/storage/file-storage.js';
import { DEV_SEED, DEV_SEED_VENUE_NAME, DEV_SEED_VENUE_SLUG } from './world.js';

const files = () => new LocalFileStorage(env.VENUE_UPLOAD_DIR, `${env.PUBLIC_API_URL.replace(/\/$/, '')}/uploads/venues`);
const COLOURS = ['#1e7d4c', '#1b58cc', '#ca3021'];

/** A generated placeholder photo (no real venue imagery): a coloured pitch with the mock label. */
const placeholder = (colour: string, index: number) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000">
    <rect width="1600" height="1000" fill="${colour}"/>
    <rect x="120" y="120" width="1360" height="760" fill="none" stroke="#fff7cb" stroke-width="10"/>
    <line x1="800" y1="120" x2="800" y2="880" stroke="#fff7cb" stroke-width="10"/>
    <circle cx="800" cy="500" r="140" fill="none" stroke="#fff7cb" stroke-width="10"/>
    <text x="800" y="960" font-family="Arial" font-size="56" fill="#fff7cb" text-anchor="middle">${DEV_SEED} placeholder photo ${index + 1}</text>
  </svg>`)).webp({ quality: 80 }).toBuffer();

/**
 * Creates the mock venue once (published, one 5/7-a-side field open daily 06:00-23:00). Safe to re-run. Two mock
 * players stand in as its submitter and approver (a published venue records both).
 */
export async function ensureMockVenue(log: (line: string) => void, submitterId: string, approverId: string) {
  if (await prisma.managedVenue.findUnique({ where: { slug: DEV_SEED_VENUE_SLUG }, select: { id: true } })) {
    log(`${DEV_SEED_VENUE_NAME}: already there.`);
    return;
  }
  const storage = files();
  const photos = [];
  for (const [index, colour] of COLOURS.entries()) {
    const key = `${randomUUID()}.webp`;
    await storage.put(key, await placeholder(colour, index));
    photos.push({ url: storage.publicUrl(key), thumbUrl: storage.publicUrl(key), storageKey: key, altText: `${DEV_SEED_VENUE_NAME} placeholder photo ${index + 1}`, attribution: `${DEV_SEED} generated placeholder` });
  }
  const from = new Date(Date.now() - 86_400_000);
  try {
  await prisma.managedVenue.create({
    data: {
      slug: DEV_SEED_VENUE_SLUG, name: DEV_SEED_VENUE_NAME,
      publicDescription: `${DEV_SEED}: a mock venue for local testing only. It does not exist.`,
      aboutText: `${DEV_SEED}: mock venue so the home page carousel has more than one card. Not a real venue.`,
      addressLine1: '1 Mock Road, Green Point', city: 'Cape Town', region: 'Western Cape', countryCode: 'ZA',
      latitude: -33.9036, longitude: 18.4106, timezone: 'Africa/Johannesburg', amenities: ['Floodlights', 'Parking'],
      coverImageUrl: photos[0]!.url, coverImageAlt: photos[0]!.altText, coverImageAttribution: photos[0]!.attribution,
      publicationStatus: 'PUBLISHED', isActive: true,
      submittedByUserId: submitterId, submittedAt: from, approvedByUserId: approverId, approvedAt: from,
      media: { create: photos.map((photo, sortOrder) => ({ ...photo, sortOrder })) },
      cancellationPolicies: { create: { effectiveFrom: from, policyText: `${DEV_SEED}: mock policy, full credit more than 24 hours before kickoff.` } },
      fields: {
        create: {
          name: 'Mock Astro Pitch',
          supportedFormats: { create: [{ format: 'FIVE_A_SIDE' }, { format: 'SEVEN_A_SIDE' }] },
          availabilityPeriods: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startMinute: 360, endMinute: 1380 })) },
          prices: { create: { amountCents: 70_000, effectiveFrom: from } },
        },
      },
    },
  });
  } catch (error) {
    for (const photo of photos) await storage.delete(photo.storageKey);
    throw error;
  }
  log(`${DEV_SEED_VENUE_NAME}: created (published, 3 placeholder photos, open daily 06:00-23:00).`);
}

/** --reset-mock: deletes the mock venue (and its photo files), or deactivates it if anything was ever booked on it. */
export async function removeMockVenue(log: (line: string) => void) {
  const venue = await prisma.managedVenue.findUnique({ where: { slug: DEV_SEED_VENUE_SLUG }, include: { media: true, fields: { select: { id: true, _count: { select: { reservations: true } } } } } });
  if (!venue) return;
  if (venue.fields.some(({ _count }) => _count.reservations > 0)) {
    await prisma.managedVenue.update({ where: { id: venue.id }, data: { publicationStatus: 'DEACTIVATED', isActive: false, deactivatedAt: new Date(), deactivationReason: `${DEV_SEED} reset` } });
    log(`${DEV_SEED_VENUE_NAME}: deactivated (it has bookings, so it is kept as history).`);
    return;
  }
  await prisma.managedFieldPrice.deleteMany({ where: { field: { venueId: venue.id } } });
  await prisma.venueCancellationPolicy.deleteMany({ where: { venueId: venue.id } });
  await prisma.managedField.deleteMany({ where: { venueId: venue.id } });
  await prisma.managedVenue.update({ where: { id: venue.id }, data: { publicationStatus: 'DRAFT', submittedByUserId: null, submittedAt: null, approvedByUserId: null, approvedAt: null } });
  await prisma.managedVenue.delete({ where: { id: venue.id } });
  for (const item of venue.media) if (item.storageKey) await files().delete(item.storageKey);
  log(`${DEV_SEED_VENUE_NAME}: removed.`);
}
