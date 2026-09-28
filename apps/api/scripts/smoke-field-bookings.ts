import './assert-disposable-test-database.js';
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
  const kickoff = new Date(Date.now() + 7 * 86_400_000);
  kickoff.setUTCMinutes(0, 0, 0);
  const venue = await prisma.managedVenue.create({ data: { slug: `${marker}-venue`, name: marker, addressLine1: '1 Booking Street', city: 'Johannesburg', region: 'Gauteng', countryCode: 'ZA', fields: { create: { name: 'Pitch One', supportedFormats: { create: { format: 'FIVE_A_SIDE' } }, availabilityPeriods: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 })) }, prices: { create: { amountCents: 80_000, effectiveFrom: new Date(Date.now() - 86_400_000) } } } } } });
  managedVenueId = venue.id;
  const field = await prisma.managedField.findFirstOrThrow({ where: { venueId: venue.id }, include: { prices: true } });
  for (const suffix of ['a', 'b']) {
    const user = await prisma.user.create({ data: { email: `${marker}-${suffix}@smoke.invalid`, username: `${suffix}_${marker.slice(-20)}`, passwordHash: 'smoke', profile: { create: { displayName: `Booking ${suffix}` } }, walletAccount: { create: {} } } });
    userIds.push(user.id);
    await serializableTransaction((tx) => financial.credit(tx, { userId: user.id, amountCents: 50_000, type: 'DEPOSIT_CREDIT', idempotencyKey: `${marker}:seed:${suffix}`, referenceType: 'SMOKE', referenceId: marker }));
  }
  await prisma.venueCancellationPolicy.create({ data: { venueId: venue.id, effectiveFrom: new Date(Date.now() - 86_400_000), policyText: 'Full credit more than 24 hours before kickoff; no late credit.' } });
  await prisma.managedVenue.update({ where: { id: venue.id }, data: { publicationStatus: 'PUBLISHED', submittedByUserId: userIds[0], submittedAt: new Date(), approvedByUserId: userIds[1], approvedAt: new Date() } });
  const startsAt = kickoff.toISOString();
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

  const expiringStartsAt = new Date(kickoff.getTime() + 3 * 60 * 60_000).toISOString();
  const expiring = await service.createPlayer({ managedFieldId: field.id, name: 'Expiry Smoke', format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 5, rollingSubstitutes: true, rules: [], visibility: 'PUBLIC', startsAt: expiringStartsAt }, userIds[0]!);
  reservationIds.push(expiring.id); matchIds.push(expiring.match.id);
  await service.contribute(expiring.id, userIds[0]!, { amountCents: 5_000 }, `${marker}:expiry-contribution`);
  holdIds.push(...(await prisma.fundingContribution.findMany({ where: { obligation: { reservationId: expiring.id } }, select: { walletHoldId: true } })).map((item) => item.walletHoldId));
  const expired = await service.expire(expiring.id);
  assert(expired?.status === 'EXPIRED', 'Funding expiry did not release the reservation.');
  assert((await prisma.walletAccount.findUniqueOrThrow({ where: { userId: userIds[0] } })).balanceCents === 10_000, 'Expired hold changed wallet balance.');

  for (const [index, userId] of userIds.entries())
    await serializableTransaction((tx) => financial.credit(tx, { userId, amountCents: 100_000, type: 'DEPOSIT_CREDIT', idempotencyKey: `${marker}:race-funds:${index}`, referenceType: 'SMOKE', referenceId: marker }));
  const raceStartsAt = new Date(kickoff.getTime() + 6 * 60 * 60_000).toISOString();
  const raceInput = { managedFieldId: field.id, name: 'Gate 3 reservation race', format: 'FIVE_A_SIDE' as const, substituteCapacityPerTeam: 5, rollingSubstitutes: true, rules: [], visibility: 'PUBLIC' as const, startsAt: raceStartsAt, feeCents: 4_000 };
  const race = await Promise.allSettled(userIds.map((userId) => service.createQuickMatch(raceInput, userId)));
  const winner = race.find((item): item is PromiseFulfilledResult<Awaited<ReturnType<BookingsService['createQuickMatch']>>> => item.status === 'fulfilled');
  const loser = race.find((item): item is PromiseRejectedResult => item.status === 'rejected');
  assert(Boolean(winner) && Boolean(loser), 'Concurrent reservation race did not produce exactly one winner.');
  assert(typeof loser!.reason === 'object' && loser!.reason?.code === 'FIELD_TIME_CONFLICT', 'Reservation race did not return the stable FIELD_TIME_CONFLICT code.');
  matchIds.push(winner!.value.id);
  const raceReservation = await prisma.fieldReservation.findUniqueOrThrow({ where: { matchId: winner!.value.id } });
  reservationIds.push(raceReservation.id);
  if (raceReservation.organizerGuaranteeHoldId) holdIds.push(raceReservation.organizerGuaranteeHoldId);
  assert(raceReservation.priceCentsSnapshot === 90_000 && raceReservation.organizerGuaranteeCents === 90_000, 'Race winner did not preserve price and guarantee snapshots.');

  let rolledBack = false;
  try { await prisma.$transaction(async (tx) => { const admin = await tx.user.create({ data: { email: `${marker}-admin@smoke.invalid`, username: `admin_${marker.slice(-18)}`, passwordHash: 'smoke', platformRole: 'ADMIN' } }); await tx.adminAuditLog.create({ data: { actorUserId: admin.id, action: 'MATCH_LOADED', entityType: 'FIELD_RESERVATION', requestId: marker } }); throw new Error('ROLLBACK_ADMIN_LOAD'); }); }
  catch (error) { rolledBack = String(error).includes('ROLLBACK_ADMIN_LOAD'); }
  assert(rolledBack && (await prisma.adminAuditLog.count({ where: { requestId: marker } })) === 0, 'Admin load audit rollback was not exact.');
} finally {
  if (reservationIds.length) {
    await prisma.durableJob.deleteMany({ where: { OR: reservationIds.flatMap((id) => [{ dedupeKey: `reservation-expire:${id}` }, { dedupeKey: `quick-match-guarantee-settle:${id}` }]) } });
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
  if (managedVenueId) { await prisma.managedFieldPrice.deleteMany({ where: { field: { venueId: managedVenueId } } }); await prisma.venueCancellationPolicy.deleteMany({ where: { venueId: managedVenueId } }); await prisma.managedField.deleteMany({ where: { venueId: managedVenueId } }); await prisma.managedVenue.deleteMany({ where: { id: managedVenueId } }); }
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  assert((await prisma.user.count({ where: { email: { startsWith: marker } } })) === 0, 'Booking smoke users remained.');
  assert((await prisma.managedVenue.count({ where: { name: marker } })) === 0, 'Booking smoke venue remained.');
  assert((await prisma.adminAuditLog.count({ where: { requestId: marker } })) === 0, 'Booking smoke audit remained.');
  await prisma.$disconnect();
}
console.log('Slice 6 price snapshots, pooled holds/capture, overlap, expiry, Admin audit rollback, and exact cleanup smoke test passed.');
