import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { MATCH_FEE_CENTS } from '@footy-finder/shared';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { MatchesRepository } from '../src/modules/matches/matches.repository.js';

/**
 * Field reservations on PostgreSQL (DEC-018 / DEC-021: players never fund venue costs and there is no wallet). A
 * host-created Quick Match reserves the field with an admin-only price snapshot and the fixed R80 fee; two hosts
 * racing for one slot get exactly one reservation (FIELD_TIME_CONFLICT for the other); there is no host guarantee;
 * a host's booking view never shows the venue cost; cancelling releases the reservation and charges nobody; and an
 * admin load's audit row rolls back with its transaction.
 */
const marker = `slice-6-${randomUUID()}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
const service = new BookingsService();
const userIds: string[] = []; const matchIds: string[] = [];
let managedVenueId = '';
try {
  // 08:00 UTC (10:00 Johannesburg) a week ahead: the bookings at kickoff and +3h stay inside one local day whatever
  // time the smoke starts (a slot may not cross local midnight).
  const kickoff = new Date(Date.now() + 7 * 86_400_000);
  kickoff.setUTCHours(8, 0, 0, 0);
  const venue = await prisma.managedVenue.create({ data: { slug: `${marker}-venue`, name: marker, addressLine1: '1 Booking Street', city: 'Johannesburg', region: 'Gauteng', countryCode: 'ZA', fields: { create: { name: 'Pitch One', supportedFormats: { create: { format: 'FIVE_A_SIDE' } }, availabilityPeriods: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 })) }, prices: { create: { amountCents: 80_000, effectiveFrom: new Date(Date.now() - 86_400_000) } } } } } });
  managedVenueId = venue.id;
  const field = await prisma.managedField.findFirstOrThrow({ where: { venueId: venue.id }, include: { prices: true } });
  for (const suffix of ['a', 'b']) {
    const user = await prisma.user.create({ data: { email: `${marker}-${suffix}@smoke.invalid`, username: `${suffix}_${marker.slice(-20)}`, passwordHash: 'smoke', profile: { create: { displayName: `Booking ${suffix}` } } } });
    userIds.push(user.id);
  }
  await prisma.venueCancellationPolicy.create({ data: { venueId: venue.id, effectiveFrom: new Date(Date.now() - 86_400_000), policyText: 'Full credit more than 24 hours before kickoff; no late credit.' } });
  await prisma.managedVenue.update({ where: { id: venue.id }, data: { publicationStatus: 'PUBLISHED', submittedByUserId: userIds[0], submittedAt: new Date(), approvedByUserId: userIds[1], approvedAt: new Date() } });
  const input = (startsAt: Date, name: string) => ({ managedFieldId: field.id, name, format: 'FIVE_A_SIDE' as const, substituteCapacityPerTeam: 5, rollingSubstitutes: true, rules: [], visibility: 'PUBLIC' as const, startsAt: startsAt.toISOString(), feeCents: 4_000 /* a host-sent fee is ignored */ });

  // 1. Two hosts race for one slot: exactly one reservation; the other gets FIELD_TIME_CONFLICT.
  const race = await Promise.allSettled(userIds.map((userId) => service.createQuickMatch(input(kickoff, 'Reservation race'), userId)));
  const winner = race.find((item): item is PromiseFulfilledResult<Awaited<ReturnType<BookingsService['createQuickMatch']>>> => item.status === 'fulfilled');
  const loser = race.find((item): item is PromiseRejectedResult => item.status === 'rejected');
  assert(Boolean(winner) && Boolean(loser), 'Concurrent reservation race did not produce exactly one winner.');
  assert(typeof loser!.reason === 'object' && loser!.reason?.code === 'FIELD_TIME_CONFLICT', 'Reservation race did not return the stable FIELD_TIME_CONFLICT code.');
  matchIds.push(winner!.value.id);
  const reservation = await prisma.fieldReservation.findUniqueOrThrow({ where: { matchId: winner!.value.id } });
  assert(winner!.value.feeCents === MATCH_FEE_CENTS, 'Host-created Quick Match did not use the fixed R80 fee.');
  assert(reservation.priceCentsSnapshot === 80_000, 'The reservation did not snapshot the admin-only venue price.');
  // DEC-018: no host guarantee. No hold, no guarantee amount, no settlement job.
  assert(reservation.organizerGuaranteeCents === 0 && reservation.organizerGuaranteeHoldId === null, 'Host-created reservation still carries a venue guarantee.');
  assert((await prisma.durableJob.count({ where: { dedupeKey: `quick-match-guarantee-settle:${reservation.id}` } })) === 0, 'A guarantee settlement job was queued.');

  // 2. The snapshot survives a catalogue price change; the host's booking view never shows the venue cost.
  await prisma.managedFieldPrice.update({ where: { id: field.prices[0]!.id }, data: { amountCents: 90_000 } });
  assert((await prisma.fieldReservation.findUniqueOrThrow({ where: { id: reservation.id } })).priceCentsSnapshot === 80_000, 'Reservation price snapshot changed with catalogue history.');
  const hostView = JSON.stringify(await service.get(reservation.id, winner!.value.createdById));
  assert(!/priceCents|amountCents|funded|remaining/i.test(hostView), 'The host booking view exposed a venue cost (DEC-018).');

  // 3. Overlap: the same field and time cannot be reserved twice.
  const overlap = await service.createQuickMatch(input(kickoff, 'Overlap'), userIds[0]!).then(() => 'OK', (error: { code?: string }) => error.code);
  assert(overlap === 'FIELD_TIME_CONFLICT', 'Overlapping reservation was not rejected with FIELD_TIME_CONFLICT.');

  // 4. Cancelling releases the reservation and charges nobody.
  await new MatchesRepository().cancelMatch(winner!.value.id);
  assert((await prisma.fieldReservation.findUniqueOrThrow({ where: { id: reservation.id } })).status === 'CANCELLED', 'Cancelled match left its field reservation active.');
  assert(!(await prisma.ticketCheckout.count({ where: { payerId: { in: userIds } } })), 'Hosting or cancelling charged someone.');
  const later = await service.createQuickMatch(input(new Date(kickoff.getTime() + 3 * 3_600_000), 'Later slot'), userIds[1]!);
  matchIds.push(later.id);
  assert(later.feeCents === MATCH_FEE_CENTS, 'A second Quick Match did not use the fixed fee.');

  // 5. An admin load's audit row rolls back with its transaction.
  let rolledBack = false;
  try { await prisma.$transaction(async (tx) => { const admin = await tx.user.create({ data: { email: `${marker}-admin@smoke.invalid`, username: `admin_${marker.slice(-18)}`, passwordHash: 'smoke', platformRole: 'ADMIN' } }); await tx.adminAuditLog.create({ data: { actorUserId: admin.id, action: 'MATCH_LOADED', entityType: 'FIELD_RESERVATION', requestId: marker } }); throw new Error('ROLLBACK_ADMIN_LOAD'); }); }
  catch (error) { rolledBack = String(error).includes('ROLLBACK_ADMIN_LOAD'); }
  assert(rolledBack && (await prisma.adminAuditLog.count({ where: { requestId: marker } })) === 0, 'Admin load audit rollback was not exact.');
} finally {
  if (matchIds.length) {
    await prisma.durableJob.deleteMany({ where: { OR: matchIds.map((id) => ({ dedupeKey: { contains: id } })) } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.fieldReservation.deleteMany({ where: { matchId: { in: matchIds } } });
    const legacyVenueIds = (await prisma.match.findMany({ where: { id: { in: matchIds } }, select: { venueId: true } })).map((item) => item.venueId);
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
    await prisma.venue.deleteMany({ where: { id: { in: legacyVenueIds } } });
  }
  if (managedVenueId) { await prisma.managedFieldPrice.deleteMany({ where: { field: { venueId: managedVenueId } } }); await prisma.venueCancellationPolicy.deleteMany({ where: { venueId: managedVenueId } }); await prisma.managedField.deleteMany({ where: { venueId: managedVenueId } }); await prisma.managedVenue.update({ where: { id: managedVenueId }, data: { publicationStatus: 'DRAFT', submittedByUserId: null, submittedAt: null, approvedByUserId: null, approvedAt: null } }); await prisma.managedVenue.delete({ where: { id: managedVenueId } }); }
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  assert((await prisma.user.count({ where: { email: { startsWith: marker } } })) === 0, 'Booking smoke users remained.');
  assert((await prisma.managedVenue.count({ where: { name: marker } })) === 0, 'Booking smoke venue remained.');
  assert((await prisma.adminAuditLog.count({ where: { requestId: marker } })) === 0, 'Booking smoke audit remained.');
  await prisma.$disconnect();
}
console.log('Field reservations smoke passed: one winner per slot (FIELD_TIME_CONFLICT), fixed R80 fee, admin-only price snapshot never shown to the host, no host guarantee, cancel releases the reservation and charges nobody, admin audit rollback exact.');
