import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';

/**
 * A disposable, published (dual-control approved) managed venue with one 5/7/11-a-side field open
 * all week, for smokes that need a real Quick Match. Since Gate 3 / DEC-018 a Quick Match can only
 * be created on a managed slot (BookingsService.createQuickMatch, fixed R80 fee), not with a
 * typed-in venue. Everything it creates is removed by `cleanupMatches` and `cleanupVenue`.
 */
export function managedVenueFixture(marker: string) {
  let venueId = '';
  let fieldId = '';
  let kickoffIndex = 0;
  const approverIds: string[] = [];
  return {
    get fieldId() {
      return fieldId;
    },
    /** 12:00 Johannesburg on a distinct day per call, 3+ days ahead: a valid 30-minute-grid slot. */
    nextKickoff() {
      const day = new Date(Date.now() + (3 + kickoffIndex++) * 86_400_000);
      day.setUTCHours(10, 0, 0, 0);
      return day;
    },
    async create() {
      for (const role of ['submitter', 'approver'])
        approverIds.push((await prisma.user.create({
          data: { email: `${marker}-venue-${role}@smoke.invalid`, username: `mv_${randomUUID().slice(0, 12)}_${role}`, passwordHash: 'smoke-test-only' },
        })).id);
      const priceFrom = new Date(Date.now() - 86_400_000);
      const venue = await prisma.managedVenue.create({
        data: {
          slug: `${marker}-venue`, name: `${marker} Park`, addressLine1: '1 Fixture Road', city: 'Cape Town', region: 'Western Cape', countryCode: 'ZA',
          fields: {
            create: {
              name: 'Main Pitch',
              supportedFormats: { create: [{ format: 'FIVE_A_SIDE' }, { format: 'SEVEN_A_SIDE' }, { format: 'ELEVEN_A_SIDE' }] },
              availabilityPeriods: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 })) },
              prices: { create: { amountCents: 50_000, effectiveFrom: priceFrom } },
            },
          },
          cancellationPolicies: { create: { effectiveFrom: priceFrom, policyText: 'Full credit more than 24 hours before kickoff.' } },
        },
        include: { fields: true },
      });
      venueId = venue.id;
      fieldId = venue.fields[0]!.id;
      await prisma.managedVenue.update({
        where: { id: venueId },
        data: { publicationStatus: 'PUBLISHED', submittedByUserId: approverIds[0], submittedAt: new Date(), approvedByUserId: approverIds[1], approvedAt: new Date() },
      });
      return fieldId;
    },
    /** Removes the matches' jobs, payables and reservations; call before deleting the matches. */
    async cleanupMatches(matchIds: string[]) {
      if (!matchIds.length) return;
      await prisma.durableJob.deleteMany({ where: { OR: matchIds.map((id) => ({ dedupeKey: { contains: id } })) } });
      await prisma.venuePayable.deleteMany({ where: { matchId: { in: matchIds } } });
      await prisma.fieldReservation.deleteMany({ where: { matchId: { in: matchIds } } });
    },
    /** Removes the venue and its approvers; call after the matches are gone. */
    async cleanupVenue() {
      if (venueId) {
        await prisma.managedFieldPrice.deleteMany({ where: { field: { venueId } } });
        await prisma.venueCancellationPolicy.deleteMany({ where: { venueId } });
        await prisma.managedField.deleteMany({ where: { venueId } });
        await prisma.managedVenue.update({ where: { id: venueId }, data: { publicationStatus: 'DRAFT', submittedByUserId: null, submittedAt: null, approvedByUserId: null, approvedAt: null } });
        await prisma.managedVenue.delete({ where: { id: venueId } });
      }
      await prisma.user.deleteMany({ where: { id: { in: approverIds } } });
    },
  };
}
