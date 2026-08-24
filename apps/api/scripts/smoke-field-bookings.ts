import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { serializableTransaction } from '../src/database/transaction.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { FinancialRepository } from '../src/modules/wallet/financial.repository.js';

const marker = `slice-6-${randomUUID()}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
const service = new BookingsService(); const financial = new FinancialRepository();
const userIds: string[] = []; const reservationIds: string[] = []; const matchIds: string[] = []; const holdIds: string[] = [];
let managedVenueId = '';
try {
  const venue = await prisma.managedVenue.create({ data: { name: marker, addressLine1: '1 Booking Street', city: 'Johannesburg', region: 'Gauteng', countryCode: 'ZA', fields: { create: { name: 'Pitch One', supportedFormats: { create: { format: 'FIVE_A_SIDE' } }, availabilityPeriods: { create: { dayOfWeek: 1, startMinute: 0, endMinute: 1440 } }, prices: { create: { amountCents: 80_000, effectiveFrom: new Date('2026-01-01T00:00:00Z') } } } } } });
  managedVenueId = venue.id;
  const field = await prisma.managedField.findFirstOrThrow({ where: { venueId: venue.id }, include: { prices: true } });
  for (const suffix of ['a', 'b']) {
    const user = await prisma.user.create({ data: { email: `${marker}-${suffix}@smoke.invalid`, username: `${suffix}_${marker.slice(-20)}`, passwordHash: 'smoke', profile: { create: { displayName: `Booking ${suffix}` } }, walletAccount: { create: {} } } });
    userIds.push(user.id);
    await serializableTransaction((tx) => financial.credit(tx, { userId: user.id, amountCents: 50_000, type: 'DEPOSIT_CREDIT', idempotencyKey: `${marker}:seed:${suffix}`, referenceType: 'SMOKE', referenceId: marker }));
  }
  const startsAt = '2027-03-01T16:00:00.000Z';
  const booking = await service.createPlayer({ managedFieldId: field.id, name: 'Pooled Booking Smoke', format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 5, rollingSubstitutes: true, rules: [], visibility: 'PUBLIC', startsAt }, userIds[0]!);
  reservationIds.push(booking.id); matchIds.push(booking.match.id);
  assert(booking.status === 'FUNDING' && booking.priceCents === 80_000, 'Player booking did not snapshot price into funding state.');
  const first = await service.contribute(booking.id, userIds[0]!, { amountCents: 40_000 }, `${marker}:contribution:a`);
  const replay = await service.contribute(booking.id, userIds[0]!, { amountCents: 40_000 }, `${marker}:contribution:a`);
  assert(first.fundedCents === 40_000 && replay.fundedCents === 40_000, 'Contribution retry changed the pool twice.');
  const confirmed = await service.contribute(booking.id, userIds[1]!, { amountCents: 40_000 }, `${marker}:contribution:b`);
  assert(confirmed.status === 'CONFIRMED' && confirmed.remainingCents === 0, 'Fully funded booking did not confirm.');
  assert((await prisma.match.findUniqueOrThrow({ where: { id: booking.match.id } })).status === 'OPEN', 'Confirmed booking Match did not open.');
  for (const id of userIds) assert((await prisma.walletAccount.findUniqueOrThrow({ where: { userId: id } })).balanceCents === 10_000, 'Captured contribution balance was incorrect.');
  holdIds.push(...(await prisma.fundingContribution.findMany({ where: { obligation: { reservationId: booking.id } }, select: { walletHoldId: true } })).map((item) => item.walletHoldId));

  await prisma.managedFieldPrice.update({ where: { id: field.prices[0]!.id }, data: { amountCents: 90_000 } });
  assert((await service.get(booking.id, userIds[0]!)).priceCents === 80_000, 'Reservation price snapshot changed with catalogue history.');
  let overlapBlocked = false;
  try { await service.createPlayer({ managedFieldId: field.id, name: 'Overlap Smoke', format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 5, rollingSubstitutes: true, rules: [], visibility: 'PUBLIC', startsAt }, userIds[0]!); }
  catch (error) { overlapBlocked = typeof error === 'object' && error !== null && 'code' in error && error.code === 'FIELD_TIME_CONFLICT'; }
  assert(overlapBlocked, 'Overlapping reservation was not rejected with FIELD_TIME_CONFLICT.');

  const expiring = await service.createPlayer({ managedFieldId: field.id, name: 'Expiry Smoke', format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 5, rollingSubstitutes: true, rules: [], visibility: 'PUBLIC', startsAt: '2027-03-01T19:00:00.000Z' }, userIds[0]!);
  reservationIds.push(expiring.id); matchIds.push(expiring.match.id);
  await service.contribute(expiring.id, userIds[0]!, { amountCents: 5_000 }, `${marker}:expiry-contribution`);
  holdIds.push(...(await prisma.fundingContribution.findMany({ where: { obligation: { reservationId: expiring.id } }, select: { walletHoldId: true } })).map((item) => item.walletHoldId));
  const expired = await service.expire(expiring.id);
  assert(expired?.status === 'EXPIRED', 'Funding expiry did not release the reservation.');
  assert((await prisma.walletAccount.findUniqueOrThrow({ where: { userId: userIds[0] } })).balanceCents === 10_000, 'Expired hold changed wallet balance.');

  let rolledBack = false;
  try { await prisma.$transaction(async (tx) => { const admin = await tx.user.create({ data: { email: `${marker}-admin@smoke.invalid`, username: `admin_${marker.slice(-18)}`, passwordHash: 'smoke', platformRole: 'ADMIN' } }); await tx.adminAuditLog.create({ data: { actorUserId: admin.id, action: 'MATCH_LOADED', entityType: 'FIELD_RESERVATION', requestId: marker } }); throw new Error('ROLLBACK_ADMIN_LOAD'); }); }
  catch (error) { rolledBack = String(error).includes('ROLLBACK_ADMIN_LOAD'); }
  assert(rolledBack && (await prisma.adminAuditLog.count({ where: { requestId: marker } })) === 0, 'Admin load audit rollback was not exact.');
} finally {
  if (reservationIds.length) {
    await prisma.durableJob.deleteMany({ where: { OR: reservationIds.map((id) => ({ dedupeKey: `reservation-expire:${id}` })) } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.fundingContribution.deleteMany({ where: { obligation: { reservationId: { in: reservationIds } } } });
    await prisma.fieldReservation.deleteMany({ where: { id: { in: reservationIds } } });
  }
  if (holdIds.length) {
    await prisma.durableJob.deleteMany({ where: { OR: holdIds.map((id) => ({ dedupeKey: `wallet-hold-expire:${id}` })) } });
    await prisma.walletHold.deleteMany({ where: { id: { in: holdIds } } });
  }
  if (matchIds.length) {
    const legacyVenueIds = (await prisma.match.findMany({ where: { id: { in: matchIds } }, select: { venueId: true } })).map((item) => item.venueId);
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
    await prisma.venue.deleteMany({ where: { id: { in: legacyVenueIds } } });
  }
  for (const id of userIds) { const wallet = await prisma.walletAccount.findUnique({ where: { userId: id } }); if (wallet) await prisma.walletTransaction.deleteMany({ where: { walletAccountId: wallet.id } }); }
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (managedVenueId) { await prisma.managedFieldPrice.deleteMany({ where: { field: { venueId: managedVenueId } } }); await prisma.managedField.deleteMany({ where: { venueId: managedVenueId } }); await prisma.managedVenue.deleteMany({ where: { id: managedVenueId } }); }
  assert((await prisma.user.count({ where: { email: { startsWith: marker } } })) === 0, 'Booking smoke users remained.');
  assert((await prisma.managedVenue.count({ where: { name: marker } })) === 0, 'Booking smoke venue remained.');
  assert((await prisma.adminAuditLog.count({ where: { requestId: marker } })) === 0, 'Booking smoke audit remained.');
  await prisma.$disconnect();
}
console.log('Slice 6 price snapshots, pooled holds/capture, overlap, expiry, Admin audit rollback, and exact cleanup smoke test passed.');
