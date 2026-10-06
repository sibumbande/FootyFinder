import './assert-disposable-test-database.js';
import { refereeFixture } from './referee-fixture.js';
import { randomUUID } from 'node:crypto';
import type { MatchFormat } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { goNoGoJobDedupeKey } from '../src/modules/matches/go-no-go.js';
import { fillReminderJobDedupeKey } from '../src/modules/matches/fill-reminder.js';
import { transitionMatchToStarted } from '../src/modules/matches/match-lifecycle.scheduler.js';
import { MatchesRepository } from '../src/modules/matches/matches.repository.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { VenueSettlementService } from '../src/modules/settlement/venue-settlement.service.js';
import { SettlementBatchesService } from '../src/modules/settlement/settlement-batches.service.js';
import { settlementWeekOf } from '../src/modules/settlement/settlement-week.js';
import { buyTicket, removeTicketRows } from './support/ticket-fixtures.js';
import { removeTicketJobsSince } from './support/ticket-job-cleanup.js';

/**
 * Gate 6 venue settlement smoke (real PostgreSQL). DEC-012 + DEC-018: a payable exists only for a
 * confirmed match that went ahead, exactly once per reservation, from the admin-only snapshot.
 * Bank details are fake, encrypted at rest, dual-control approved and revealed only with audit.
 */
const marker = `gate6-settle-${randomUUID()}`;
// Gate 8: a match also needs an active referee to be confirmed at T-30 (DEC-020).
const referee = refereeFixture(marker);
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'OK';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
};
const bookings = new BookingsService();
const matches = new MatchesRepository();
const service = new MatchesService();
const smokeStartedAt = new Date();
const settlement = new VenueSettlementService();
const userIds: string[] = [];
const matchIds: string[] = [];
let hostId = '';
let venueId = '';
let fieldId = '';
let matchIndex = 0;
// AdminAuditLog is append-only, so the two disposable admins and their audit rows are retained.
const admins: string[] = [];

const nextKickoff = () => {
  const day = new Date(Date.now() + (3 + matchIndex++) * 86_400_000);
  day.setUTCHours(10, 0, 0, 0);
  return day;
};

async function createMatch(format: MatchFormat = 'FIVE_A_SIDE') {
  const match = await bookings.createQuickMatch(
    {
      managedFieldId: fieldId,
      name: `${marker}-${matchIndex}`,
      format,
      substituteCapacityPerTeam: 5,
      rollingSubstitutes: false,
      rules: [],
      visibility: 'PUBLIC',
      startsAt: nextKickoff().toISOString(),
    },
    hostId,
  );
  matchIds.push(match.id);
  await referee.assign(match.id);
  return match;
}

/** Joins players alternately and claims every formation slot when fill is true. */
async function joinPlayers(matchId: string, players: string[], fill: boolean) {
  const slots = await prisma.formationSlot.findMany({ where: { matchId }, orderBy: [{ team: 'asc' }, { slotIndex: 'asc' }] });
  const home = slots.filter((slot) => slot.team === 'HOME');
  const away = slots.filter((slot) => slot.team === 'AWAY');
  for (const [index, userId] of players.entries()) {
    const team = index % 2 === 0 ? 'HOME' : 'AWAY';
    await buyTicket(matchId, userId, team, `${marker}:join:${matchId}:${userId}`);
    const target = (team === 'HOME' ? home : away)[Math.floor(index / 2)];
    if (fill && target) await matches.claimPosition(matchId, target.id, userId);
  }
}

async function decideAt(matchId: string) {
  const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
  return service.decideGoNoGo(matchId, match.goNoGoAt!);
}

async function main() {
  const users = await Promise.all(
    Array.from({ length: 13 }, (_, index) =>
      prisma.user.create({
        data: {
          email: `${marker}-${index}@smoke.invalid`,
          username: `${marker.slice(-16)}_${index}`,
          passwordHash: 'smoke',
          profile: { create: { displayName: `Settlement ${index}` } },
        },
      }),
    ),
  );
  userIds.push(...users.map(({ id }) => id));
  hostId = userIds[0]!;
  for (const label of ['a', 'b']) {
    const admin = await prisma.user.create({
      data: { email: `${marker}-admin-${label}@smoke.invalid`, username: `${marker.slice(-14)}_adm_${label}`, passwordHash: 'smoke', platformRole: 'ADMIN' },
    });
    admins.push(admin.id);
  }
  const [adminA, adminB] = admins as [string, string];
  const priceFrom = new Date(Date.now() - 86_400_000);
  const venue = await prisma.managedVenue.create({
    data: {
      slug: `${marker}-venue`,
      name: marker,
      addressLine1: '1 Settlement Road',
      city: 'Cape Town',
      region: 'Western Cape',
      countryCode: 'ZA',
      fields: {
        create: {
          name: 'Main Pitch',
          supportedFormats: { create: [{ format: 'FIVE_A_SIDE' }] },
          availabilityPeriods: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 })) },
          prices: { create: [{ amountCents: 50_000, format: 'FIVE_A_SIDE', effectiveFrom: priceFrom }] },
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
    data: { publicationStatus: 'PUBLISHED', submittedByUserId: adminA, submittedAt: new Date(), approvedByUserId: adminB, approvedAt: new Date() },
  });
  const players = userIds.slice(1);

  // 1. A confirmed match that goes ahead owes its venue exactly once, from the snapshot.
  const played = await createMatch();
  await joinPlayers(played.id, players.slice(0, 10), true);
  assert((await decideAt(played.id)).outcome === 'CONFIRMED', 'Full match was not confirmed at T-30.');
  assert((await prisma.venuePayable.count({ where: { matchId: played.id } })) === 0, 'A payable existed before kickoff.');
  const starts = await Promise.allSettled([transitionMatchToStarted(played.id), transitionMatchToStarted(played.id), transitionMatchToStarted(played.id)]);
  assert(starts.filter((result) => result.status === 'fulfilled' && result.value).length === 1, 'Kickoff transition did not happen exactly once.');
  const payables = await prisma.venuePayable.findMany({ where: { matchId: played.id } });
  const reservation = await prisma.fieldReservation.findUniqueOrThrow({ where: { matchId: played.id } });
  assert(payables.length === 1, 'Kickoff did not create exactly one payable.');
  assert(payables[0]!.amountCents === reservation.priceCentsSnapshot && reservation.priceCentsSnapshot === 50_000, 'Payable is not the admin-only price snapshot.');
  assert(payables[0]!.status === 'DUE' && payables[0]!.dueAt.toISOString() === new Date(played.startsAt).toISOString(), 'Payable not DUE at kickoff.');
  assert(payables[0]!.venueId === venueId && payables[0]!.reservationId === reservation.id, 'Payable not linked to its venue and reservation.');

  // 2. T-30 auto-cancel: no payable, ever.
  const unfilled = await createMatch();
  await joinPlayers(unfilled.id, players.slice(0, 3), true);
  assert((await decideAt(unfilled.id)).outcome === 'CANCELLED', 'Unfilled match was not cancelled.');
  assert(!(await transitionMatchToStarted(unfilled.id)), 'A cancelled match kicked off.');
  assert((await prisma.venuePayable.count({ where: { matchId: unfilled.id } })) === 0, 'A T-30 cancelled match created a payable.');

  // 3. Host cancel: no payable.
  const hostCancelled = await createMatch();
  await joinPlayers(hostCancelled.id, players.slice(0, 2), true);
  await service.remove(hostCancelled.id, hostId);
  assert(!(await transitionMatchToStarted(hostCancelled.id)), 'A host-cancelled match kicked off.');
  assert((await prisma.venuePayable.count({ where: { matchId: hostCancelled.id } })) === 0, 'A host-cancelled match created a payable.');

  // 4. D4: a legacy match (no go/no-go) that kicks off creates no payable.
  const legacy = await createMatch();
  await prisma.durableJob.deleteMany({ where: { dedupeKey: { in: [goNoGoJobDedupeKey(legacy.id), fillReminderJobDedupeKey(legacy.id)] } } });
  await prisma.match.update({ where: { id: legacy.id }, data: { goNoGoAt: null, confirmedAt: null, refereeUserId: null, refereeAssignedAt: null } });
  assert(await transitionMatchToStarted(legacy.id), 'Legacy match did not start.');
  assert((await prisma.venuePayable.count({ where: { matchId: legacy.id } })) === 0, 'A legacy match created a payable.');

  // 5. The database refuses ineligible payables even if application code tried.
  const unfilledReservation = await prisma.fieldReservation.findUniqueOrThrow({ where: { matchId: unfilled.id } });
  const refused = async (data: { reservationId: string; matchId: string; amountCents: number }) =>
    prisma.venuePayable.create({ data: { ...data, venueId, dueAt: new Date() } }).then(() => 'OK', (error: unknown) => String(error));
  assert((await refused({ reservationId: unfilledReservation.id, matchId: unfilled.id, amountCents: 50_000 })).includes('not eligible'), 'DB accepted a payable for a cancelled match.');
  const legacyReservation = await prisma.fieldReservation.findUniqueOrThrow({ where: { matchId: legacy.id } });
  assert((await refused({ reservationId: legacyReservation.id, matchId: legacy.id, amountCents: 50_000 })).includes('not eligible'), 'DB accepted a payable for an unconfirmed match.');
  const duplicate = await refused({ reservationId: reservation.id, matchId: played.id, amountCents: 50_000 });
  assert(duplicate !== 'OK', 'DB accepted a second payable for one reservation.');

  // 6. Beneficiary: fake details, encrypted at rest, second-admin approval, audited reveal.
  const fakeDetails = { bankName: 'Test Bank (fake)', accountHolder: 'Smoke Venue Trust (fake)', accountNumber: '62000000001', branchCode: '250655', accountType: 'CHEQUE' as const };
  const beneficiary = await settlement.createBeneficiary(adminA, venueId, { displayName: 'Smoke Venue Trust (fake)', details: fakeDetails }, marker);
  const stored = await prisma.venueBeneficiary.findUniqueOrThrow({ where: { id: beneficiary.id } });
  assert(!stored.encryptedDetails.includes('62000000001') && !stored.encryptedDetails.includes('250655'), 'Bank details stored in plaintext.');
  assert(beneficiary.accountLast4 === '0001' && !JSON.stringify(beneficiary).includes('62000000001'), 'Beneficiary DTO is not masked.');
  assert((await code(settlement.approveBeneficiary(adminA, beneficiary.id))) === 'BENEFICIARY_DUAL_CONTROL_REQUIRED', 'Creator approved their own bank details.');
  assert((await settlement.approveBeneficiary(adminB, beneficiary.id)).status === 'APPROVED', 'Second admin could not approve.');
  const revealed = await settlement.revealBeneficiary(adminB, beneficiary.id, marker);
  assert(JSON.stringify(revealed) === JSON.stringify(fakeDetails), 'Reveal did not return the stored details.');
  assert((await prisma.adminAuditLog.count({ where: { entityId: beneficiary.id, action: 'VENUE_BENEFICIARY_REVEALED' } })) === 1, 'Reveal not audited.');
  const audits = await prisma.adminAuditLog.findMany({ where: { entityId: beneficiary.id } });
  assert(!JSON.stringify(audits).includes('62000000001'), 'Bank details leaked into the audit log.');
  const replacement = await settlement.createBeneficiary(adminB, venueId, { displayName: 'Smoke Venue Trust (fake, new)', details: { ...fakeDetails, accountNumber: '62000000002' } });
  await settlement.approveBeneficiary(adminA, replacement.id);
  const venueBeneficiaries = await settlement.beneficiaries(venueId);
  assert(venueBeneficiaries.filter((row) => row.status === 'APPROVED').length === 1, 'More than one approved beneficiary per venue.');

  // 7. Adjustments: reasoned, audited, and never make an unpaid payable negative.
  const adjusted = await settlement.addAdjustment(adminA, payables[0]!.id, { amountCents: -10_000, reason: 'Floodlights failed for 15 minutes' });
  assert(adjusted.adjustmentsCents === -10_000, 'Adjustment not recorded.');
  assert((await code(settlement.addAdjustment(adminA, payables[0]!.id, { amountCents: -45_000, reason: 'Too large' }))) === 'ADJUSTMENT_INVALID', 'Adjustment took the payable below zero.');

  // 8. TKT-608 weekly dual-control settlement.
  const batches = new SettlementBatchesService();
  const weekStart = settlementWeekOf(new Date(played.startsAt));
  const afterWeek = new Date(new Date(played.startsAt).getTime() + 14 * 86_400_000);
  assert((await code(batches.prepare(adminA, { venueId, weekStart }))) === 'SETTLEMENT_WEEK_OPEN', 'An open week could be settled.');
  assert((await code(batches.prepare(adminA, { venueId, weekStart: '2026-10-27' }, marker, afterWeek))) === 'SETTLEMENT_WEEK_INVALID', 'A non-Monday week was accepted.');
  const first = await batches.prepare(adminA, { venueId, weekStart }, marker, afterWeek);
  assert(first.status === 'PREPARED' && first.totalCents === 40_000 && first.payablesCents === 50_000 && first.adjustmentsCents === -10_000, 'Prepared total is wrong.');
  assert(first.beneficiary.id === replacement.id && !JSON.stringify(first).includes('62000000002'), 'Batch does not snapshot the masked approved beneficiary.');
  assert((await prisma.venuePayable.findUniqueOrThrow({ where: { id: payables[0]!.id } })).status === 'IN_BATCH', 'Payable not locked into the batch.');
  assert((await code(batches.prepare(adminA, { venueId, weekStart }, marker, afterWeek))) !== 'OK', 'The same week was prepared twice.');
  assert((await code(settlement.addAdjustment(adminA, payables[0]!.id, { amountCents: -1_000, reason: 'Late change' }))) === 'PAYABLE_LOCKED', 'A payable in a batch could be adjusted.');
  assert((await code(batches.approve(adminA, first.id))) === 'SETTLEMENT_DUAL_CONTROL_REQUIRED', 'The preparer approved their own batch.');
  assert((await code(batches.markPaid(adminB, first.id, { payoutReference: `${marker}-early`, evidenceNote: 'Too early' }))) === 'SETTLEMENT_NOT_APPROVED', 'An unapproved batch was paid.');

  // Cancel returns everything to the queue; preparing again works.
  const cancelled = await batches.cancel(adminB, first.id, 'Wrong bank details selected');
  assert(cancelled.status === 'CANCELLED', 'Cancel failed.');
  assert((await prisma.venuePayable.findUniqueOrThrow({ where: { id: payables[0]!.id } })).status === 'DUE', 'Cancelled batch did not release its payable.');
  assert((await prisma.venuePayableAdjustment.count({ where: { payableId: payables[0]!.id, appliedBatchId: null } })) === 1, 'Cancelled batch did not release its adjustment.');
  const second = await batches.prepare(adminA, { venueId, weekStart }, marker, afterWeek);
  const approvals = await Promise.allSettled([batches.approve(adminB, second.id), batches.approve(adminB, second.id)]);
  assert(approvals.filter((result) => result.status === 'fulfilled').length === 1, 'Concurrent approvals did not produce exactly one approval.');
  assert((await code(batches.markPaid(adminA, second.id, { payoutReference: `${marker}-eft`, evidenceNote: 'EFT confirmation (fake)' }))) === 'SETTLEMENT_DUAL_CONTROL_REQUIRED', 'The preparer marked their own batch paid.');
  const payouts = await Promise.allSettled([
    batches.markPaid(adminB, second.id, { payoutReference: `${marker}-eft`, evidenceNote: 'EFT confirmation (fake)' }),
    batches.markPaid(adminB, second.id, { payoutReference: `${marker}-eft-2`, evidenceNote: 'EFT confirmation (fake)' }),
  ]);
  assert(payouts.filter((result) => result.status === 'fulfilled').length === 1, 'A batch was paid twice.');
  const paid = await batches.get(second.id);
  assert(paid.status === 'PAID' && paid.totalCents === 40_000 && paid.paidByUserId === adminB, 'Paid batch state is wrong.');
  assert((await prisma.venuePayable.findUniqueOrThrow({ where: { id: payables[0]!.id } })).status === 'PAID', 'Payable not marked paid.');
  assert((await code(batches.markPaid(adminB, second.id, { payoutReference: `${marker}-eft-3`, evidenceNote: 'Again' }))) === 'SETTLEMENT_ALREADY_PAID', 'A paid batch could be paid again.');
  assert((await code(batches.cancel(adminB, second.id, 'Too late to cancel'))) === 'SETTLEMENT_NOT_CANCELLABLE', 'A paid batch could be cancelled.');
  const immutable = async (work: Promise<unknown>) => (await work.then(() => 'OK', (error: unknown) => String(error))).includes('immutable');
  assert(await immutable(prisma.venuePayable.update({ where: { id: payables[0]!.id }, data: { status: 'DUE', batchId: null, paidAt: null } })), 'DB allowed a paid payable to reopen.');
  assert(await immutable(prisma.venueSettlementBatch.update({ where: { id: second.id }, data: { totalCents: 1 } })), 'DB allowed a paid batch to change.');
  const auditActions = (await prisma.adminAuditLog.findMany({ where: { entityId: { in: [first.id, second.id] } } })).map((row) => row.action).sort();
  assert(
    JSON.stringify(auditActions) === JSON.stringify(['VENUE_SETTLEMENT_APPROVED', 'VENUE_SETTLEMENT_CANCELLED', 'VENUE_SETTLEMENT_PAID', 'VENUE_SETTLEMENT_PREPARED', 'VENUE_SETTLEMENT_PREPARED']),
    `Settlement transitions not audited exactly: ${auditActions.join(',')}`,
  );

  // A correction to an already-paid payable is carried into the venue's next settlement.
  await settlement.addAdjustment(adminA, payables[0]!.id, { amountCents: 5_000, reason: 'Venue under-billed a 7-a-side booking' });
  const nextWeek = settlementWeekOf(new Date(new Date(played.startsAt).getTime() + 7 * 86_400_000));
  const carried = await batches.prepare(adminA, { venueId, weekStart: nextWeek }, marker, new Date(afterWeek.getTime() + 7 * 86_400_000));
  assert(carried.payablesCents === 0 && carried.adjustmentsCents === 5_000 && carried.totalCents === 5_000, 'Adjustment on a paid payable was not carried forward.');
  await batches.cancel(adminB, carried.id, 'Smoke cleanup: carried adjustment only');
  const dueList = await batches.due(afterWeek);
  assert(dueList.some((row) => row.venue.id === venueId && row.unappliedAdjustmentsCents === 5_000), 'Due summary misses the carried adjustment.');

  // 9. Players never see any of this.
  const participant = players[0]!;
  const playerMatch = await service.get(played.id, participant);
  assert(!JSON.stringify(playerMatch).match(/payable|beneficiary|priceCents|50000/i), 'A player match DTO exposed venue settlement data.');

  console.log('Gate 6 venue settlement smoke passed: one payable per played match at kickoff from the snapshot, none for T-30/host-cancelled or legacy matches, DB eligibility trigger, encrypted dual-control beneficiaries with audited reveal, adjustments, weekly dual-control batches (prepare/approve/pay, cancel, no double pay, immutable once paid, carried adjustments), player privacy.');
}

/**
 * Paid settlement batches and paid payables are immutable by design (DB trigger), so the played
 * match, its reservation, the venue, the beneficiary it paid and the host stay in the disposable
 * test database, tagged with the smoke marker. Everything else is removed.
 */
async function cleanup() {
  await referee.cleanupJobs(matchIds);
  const paidMatchIds = (await prisma.venuePayable.findMany({ where: { matchId: { in: matchIds }, status: 'PAID' }, select: { matchId: true } })).map(({ matchId }) => matchId);
  const removableMatchIds = matchIds.filter((id) => !paidMatchIds.includes(id));
  const reservationIds = (await prisma.fieldReservation.findMany({ where: { matchId: { in: removableMatchIds } }, select: { id: true } })).map(({ id }) => id);
  await prisma.venuePayableAdjustment.deleteMany({ where: { payable: { matchId: { in: matchIds } }, OR: [{ appliedBatchId: null }, { appliedBatch: { status: { not: 'PAID' } } }] } });
  await prisma.venuePayable.updateMany({ where: { matchId: { in: removableMatchIds }, batchId: { not: null } }, data: { status: 'DUE', batchId: null } });
  if (venueId) await prisma.venueSettlementBatch.deleteMany({ where: { venueId, status: { not: 'PAID' } } });
  await prisma.venuePayable.deleteMany({ where: { matchId: { in: removableMatchIds } } });
  if (venueId) await prisma.venueBeneficiary.deleteMany({ where: { venueId, settlementBatches: { none: {} } } });
  await prisma.durableJob.deleteMany({
    where: {
      OR: [
        ...matchIds.map((id) => ({ dedupeKey: goNoGoJobDedupeKey(id) })),
        ...matchIds.map((id) => ({ dedupeKey: fillReminderJobDedupeKey(id) })),
        ...matchIds.map((id) => ({ dedupeKey: { startsWith: `match-cancelled-email:${id}:` } })),
        ...reservationIds.map((id) => ({ dedupeKey: `reservation-expire:${id}` })),
      ],
    },
  });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await removeTicketJobsSince(smokeStartedAt);
  await removeTicketRows(matchIds);
  await prisma.fieldReservation.deleteMany({ where: { id: { in: reservationIds } } });
  const venueIds = (await prisma.match.findMany({ where: { id: { in: removableMatchIds } }, select: { venueId: true } })).map(({ venueId: id }) => id);
  await prisma.match.deleteMany({ where: { id: { in: removableMatchIds } } });
  await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  const retainedUserIds = paidMatchIds.length ? [hostId] : [];
  const removableUserIds = userIds.filter((id) => !retainedUserIds.includes(id));
  if (venueId && !paidMatchIds.length) {
    await prisma.managedFieldPrice.deleteMany({ where: { field: { venueId } } });
    await prisma.venueCancellationPolicy.deleteMany({ where: { venueId } });
    await prisma.managedField.deleteMany({ where: { venueId } });
    await prisma.managedVenue.update({ where: { id: venueId }, data: { publicationStatus: 'DRAFT', submittedByUserId: null, submittedAt: null, approvedByUserId: null, approvedAt: null } });
    await prisma.managedVenue.delete({ where: { id: venueId } });
  }
  // Gate 8: the retained paid match keeps its kickoff lineup record; drop the entries of the players removed here.
  await prisma.matchLineupEntry.deleteMany({ where: { userId: { in: removableUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: removableUserIds } } });
  await referee.cleanup();
  assert((await prisma.match.count({ where: { id: { in: removableMatchIds } } })) === 0, 'Smoke matches remained.');
}

try {
  await main();
} finally {
  await cleanup().catch((error: unknown) => {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  });
  await prisma.$disconnect();
}
