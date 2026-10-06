import './assert-disposable-test-database.js';
import { refereeFixture } from './referee-fixture.js';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { prisma } from '../src/database/prisma.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { fillReminderJobDedupeKey } from '../src/modules/matches/fill-reminder.js';
import { goNoGoJobDedupeKey } from '../src/modules/matches/go-no-go.js';
import { transitionMatchToStarted } from '../src/modules/matches/match-lifecycle.scheduler.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { CardRefundsService } from '../src/modules/payments/card-refunds.service.js';
import { PaystackClient } from '../src/modules/payments/paystack.client.js';
import { createPaystackWebhookRouter } from '../src/modules/payments/paystack-webhook.js';
import { PaystackWebhookProcessor } from '../src/modules/payments/paystack-webhook.jobs.js';
import { SettlementBatchesService } from '../src/modules/settlement/settlement-batches.service.js';
import { settlementWeekOf } from '../src/modules/settlement/settlement-week.js';
import { VenueSettlementService } from '../src/modules/settlement/venue-settlement.service.js';
import { TicketCheckoutService } from '../src/modules/tickets/ticket-checkout.service.js';
import { TicketLeaveService } from '../src/modules/tickets/ticket-leave.service.js';
import { TicketReconciliationService } from '../src/modules/tickets/ticket-reconciliation.service.js';
import { TicketSettlementService } from '../src/modules/tickets/ticket-settlement.service.js';
import { FAKE_PAYSTACK_SECRET, FakePaystack } from './support/fake-paystack-server.js';
import { removeTicketJobsSince } from './support/ticket-job-cleanup.js';
import { removeTicketRows } from './support/ticket-fixtures.js';

/**
 * TKT-609 / DEC-021 payment-to-settlement E2E on real PostgreSQL with a fake Paystack over HTTP:
 * match tickets paid on Paystack and confirmed by signed webhooks -> T-30 confirmed -> kickoff payable ->
 * a leaver's refund to the original method -> a chargeback that restricts bookings and is won ->
 * weekly dual-control settlement paid -> ticket reconciliation finds zero issues for these fixtures, and
 * every injected inconsistency is detected.
 */
const marker = `gate6-e2e-${randomUUID()}`;
// Gate 8: a match also needs an active referee to be confirmed at T-30 (DEC-020).
const referee = refereeFixture(marker);
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const smokeStartedAt = new Date();
const fake = await new FakePaystack().start();
const gateway = new PaystackClient({ secretKey: FAKE_PAYSTACK_SECRET, baseUrl: fake.baseUrl, channels: ['card'] });
const ticketSettlement = new TicketSettlementService(gateway, undefined, ['card']);
const checkouts = new TicketCheckoutService(gateway, undefined, ticketSettlement, {
  clientUrl: 'http://localhost:5173', demo: () => false, paystackEnabled: () => true, termsVersion: async () => '2.4',
});
const refunds = new CardRefundsService(gateway);
const processor = new PaystackWebhookProcessor(refunds, undefined, ticketSettlement);
const hook = express().use('/payments', createPaystackWebhookRouter({ secret: () => FAKE_PAYSTACK_SECRET, ipAllowlist: () => [] }));
const bookings = new BookingsService();
const matchService = new MatchesService();
const leaving = new TicketLeaveService();
const venues = new VenueSettlementService();
const batches = new SettlementBatchesService();
const reconciliation = new TicketReconciliationService();
const startedAt = new Date();
const userIds: string[] = [];
const admins: string[] = [];
const matchIds: string[] = [];
let venueId = '';
let hostId = '';

const deliver = async (event: string, data: Record<string, unknown>) => {
  const signed = fake.signedEvent(event, data);
  const response = await request(hook).post('/payments/paystack/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', signed.signature).send(signed.raw);
  assert(response.status === 200, `Webhook ${event} not accepted.`);
  const events = await prisma.paymentWebhookEvent.findMany({ where: { signatureValid: true, processedAt: null, receivedAt: { gte: startedAt } } });
  for (const stored of events) await processor.process(stored.id);
};

/** Issues that concern this run's fixtures only (the test database may hold other data). */
const ourIssues = async () => {
  const report = await reconciliation.report();
  const ids = new Set<string>([...userIds, ...matchIds]);
  const add = (rows: Array<{ id: string }>) => rows.forEach(({ id }) => ids.add(id));
  add(await prisma.matchTicket.findMany({ where: { matchId: { in: matchIds } }, select: { id: true } }));
  add(await prisma.providerPayment.findMany({ where: { userId: { in: userIds } }, select: { id: true } }));
  add(await prisma.providerRefund.findMany({ where: { providerPayment: { userId: { in: userIds } } }, select: { id: true } }));
  add(await prisma.matchCredit.findMany({ where: { userId: { in: userIds } }, select: { id: true } }));
  add(await prisma.venuePayable.findMany({ where: { matchId: { in: matchIds } }, select: { id: true } }));
  add(await prisma.venueSettlementBatch.findMany({ where: { venueId }, select: { id: true } }));
  return report.issues.filter((issue) => [issue.userId, issue.referenceId].some((value) => value && ids.has(value)));
};
const detects = async (code: string, label: string) => {
  const issues = await ourIssues();
  assert(issues.some((issue) => issue.code === code), `Injected ${label} was not detected (${code}). Got: ${issues.map((i) => i.code).join(',')}`);
};

/** Pays for one place on Paystack's hosted checkout; the signed webhook confirms it. Returns the payment. */
const buyOnPaystack = async (matchId: string, userId: string, input: { seat: 'POSITION' | 'SUBSTITUTE'; side: 'HOME' | 'AWAY'; slotId?: string }) => {
  const started = await checkouts.start(matchId, userId, { ...input, method: 'PAYMENT', acceptPolicy: true }, `${marker}:${userId}`);
  assert(started.state === 'PROCESSING' && started.reference, 'A paid ticket did not go to Paystack.');
  fake.pay(started.reference);
  await deliver('charge.success', { reference: started.reference, amount: started.amountCents });
  const payment = await prisma.providerPayment.findUniqueOrThrow({ where: { reference: started.reference } });
  const ticket = await prisma.matchTicket.findFirstOrThrow({ where: { checkoutId: started.checkoutId } });
  assert(payment.status === 'SUCCEEDED' && ticket.status === 'CONFIRMED', 'The webhook did not confirm the ticket.');
  return payment;
};

async function main() {
  const users = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      prisma.user.create({
        data: {
          email: `${marker}-${index}@smoke.invalid`,
          username: `${marker.slice(-16)}_${index}`,
          passwordHash: 'smoke',
          emailVerifiedAt: new Date(),
          onboardingCompletedAt: new Date(),
          profile: { create: { displayName: `E2E ${index}`, onboardingStatus: 'COMPLETE', gender: 'MALE' } },
        },
      }),
    ),
  );
  userIds.push(...users.map(({ id }) => id));
  hostId = userIds[0]!;
  const players = userIds.slice(1, 11);
  const leaver = userIds[11]!;
  for (const label of ['a', 'b'])
    admins.push((await prisma.user.create({ data: { email: `${marker}-admin-${label}@smoke.invalid`, username: `${marker.slice(-14)}_adm_${label}`, passwordHash: 'smoke', platformRole: 'ADMIN' } })).id);
  const [adminA, adminB] = admins as [string, string];
  const priceFrom = new Date(Date.now() - 86_400_000);
  const venue = await prisma.managedVenue.create({
    data: {
      slug: `${marker}-venue`, name: marker, addressLine1: '1 E2E Road', city: 'Cape Town', region: 'Western Cape', countryCode: 'ZA',
      fields: { create: { name: 'Main Pitch', supportedFormats: { create: [{ format: 'FIVE_A_SIDE' }] }, availabilityPeriods: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 })) }, prices: { create: [{ amountCents: 50_000, format: 'FIVE_A_SIDE', effectiveFrom: priceFrom }] } } },
      cancellationPolicies: { create: { effectiveFrom: priceFrom, policyText: 'Full credit more than 24 hours before kickoff.' } },
    },
    include: { fields: true },
  });
  venueId = venue.id;
  await prisma.managedVenue.update({ where: { id: venueId }, data: { publicationStatus: 'PUBLISHED', submittedByUserId: adminA, submittedAt: new Date(), approvedByUserId: adminB, approvedAt: new Date() } });

  // 1. Ten players each buy an R80 position on Paystack; only the verified webhook path places them.
  const kickoff = new Date(Date.now() + 4 * 86_400_000);
  kickoff.setUTCHours(10, 0, 0, 0);
  const match = await bookings.createQuickMatch({ managedFieldId: venue.fields[0]!.id, name: marker, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 5, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: kickoff.toISOString() }, hostId);
  matchIds.push(match.id);
  await referee.assign(match.id);
  const slots = await prisma.formationSlot.findMany({ where: { matchId: match.id }, orderBy: [{ team: 'asc' }, { slotIndex: 'asc' }] });
  const payments = new Map<string, Awaited<ReturnType<typeof buyOnPaystack>>>();
  for (const [index, player] of players.entries()) {
    const side = index % 2 === 0 ? 'HOME' : 'AWAY';
    payments.set(player, await buyOnPaystack(match.id, player, { seat: 'POSITION', side, slotId: slots.filter((slot) => slot.team === side)[Math.floor(index / 2)]!.id }));
  }
  assert((await prisma.formationSlot.count({ where: { matchId: match.id, participantId: { not: null } } })) === 10, 'Not every paid position was placed.');

  // 2. A substitute pays, then leaves more than 24 hours before kick-off for a refund to the card (A2, A7).
  const leaverPayment = await buyOnPaystack(match.id, leaver, { seat: 'SUBSTITUTE', side: 'HOME' });
  assert((await leaving.leave(match.id, leaver, 'REFUND')).outcome === 'REFUNDED', 'Leaving more than 24 hours before did not refund.');
  const leaverRefund = await prisma.providerRefund.findFirstOrThrow({ where: { providerPaymentId: leaverPayment.id } });
  const sent = await refunds.submitQueued(leaverRefund.id);
  assert(sent?.providerRefundId, 'The ticket refund was not sent to Paystack.');
  await deliver('refund.processed', { id: Number(sent.providerRefundId), transaction_reference: leaverPayment.reference, amount: 8_000, status: 'processed' });
  assert((await prisma.providerRefund.findUniqueOrThrow({ where: { id: leaverRefund.id } })).status === 'PROCESSED', 'refund.processed was not applied.');

  // 3. A chargeback restricts the payer's bookings (the ticket stays valid, D9); won, the restriction lifts.
  const disputePlayer = players[1]!;
  const disputeReference = payments.get(disputePlayer)!.reference;
  await deliver('charge.dispute.create', { id: 990_001, refund_amount: 8_000, transaction: { reference: disputeReference, amount: 8_000 } });
  assert((await prisma.user.findUniqueOrThrow({ where: { id: disputePlayer } })).bookingRestrictedAt, 'A chargeback did not restrict bookings.');
  await deliver('charge.dispute.resolve', { id: 990_001, resolution: 'declined', status: 'resolved', transaction: { reference: disputeReference } });
  assert(!(await prisma.user.findUniqueOrThrow({ where: { id: disputePlayer } })).bookingRestrictedAt, 'A won dispute did not lift the restriction.');

  // 4. Confirmed at T-30, kicks off -> one payable from the admin-only snapshot.
  const record = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
  assert((await matchService.decideGoNoGo(match.id, record.goNoGoAt!)).outcome === 'CONFIRMED', 'Match not confirmed.');
  assert(await transitionMatchToStarted(match.id), 'Match did not kick off.');
  const payable = await prisma.venuePayable.findUniqueOrThrow({ where: { matchId: match.id } });
  assert(payable.amountCents === 50_000, 'Payable is not the venue cost snapshot.');

  // 5. Weekly dual-control settlement with fake bank details.
  const beneficiary = await venues.createBeneficiary(adminA, venueId, { displayName: 'E2E Venue Trust (fake)', details: { bankName: 'Test Bank (fake)', accountHolder: 'E2E Venue Trust (fake)', accountNumber: '62000000009', branchCode: '250655', accountType: 'CHEQUE' } });
  await venues.approveBeneficiary(adminB, beneficiary.id);
  const afterWeek = new Date(kickoff.getTime() + 14 * 86_400_000);
  const batch = await batches.prepare(adminA, { venueId, weekStart: settlementWeekOf(kickoff) }, marker, afterWeek);
  await batches.approve(adminB, batch.id);
  const paid = await batches.markPaid(adminB, batch.id, { payoutReference: `${marker}-eft`, evidenceNote: 'EFT confirmation (fake)' });
  assert(paid.status === 'PAID' && paid.totalCents === 50_000, 'Settlement not paid for the venue cost.');

  // 6. Known fixtures reconcile to zero issues.
  const clean = await ourIssues();
  assert(clean.length === 0, `Reconciliation found issues in clean fixtures: ${JSON.stringify(clean)}`);

  // 7. Injected inconsistencies are detected (each is reverted afterwards).
  const victimPayment = payments.get(players[2]!)!;
  await prisma.providerPayment.update({ where: { id: victimPayment.id }, data: { status: 'INITIALIZED' } });
  await detects('TICKET_PAYMENT_UNVERIFIED', 'a confirmed ticket without a verified payment');
  await prisma.providerPayment.update({ where: { id: victimPayment.id }, data: { status: 'SUCCEEDED' } });

  const reservation = await prisma.fieldReservation.findUniqueOrThrow({ where: { matchId: match.id } });
  await prisma.fieldReservation.update({ where: { id: reservation.id }, data: { priceCentsSnapshot: 60_000 } });
  await detects('PAYABLE_AMOUNT_MISMATCH', 'payable not equal to the snapshot');
  await prisma.fieldReservation.update({ where: { id: reservation.id }, data: { priceCentsSnapshot: 50_000 } });

  await prisma.providerRefund.update({ where: { id: leaverRefund.id }, data: { amountCents: 17_000 } });
  await detects('REFUND_AMOUNT_MISMATCH', 'a refund that is not the ticket price');
  await detects('REFUNDS_EXCEED_PAYMENT', 'refunds above the payment');
  await prisma.providerRefund.update({ where: { id: leaverRefund.id }, data: { amountCents: 8_000, providerRefundId: null } });
  await detects('REFUND_WITHOUT_PROVIDER_EVENT', 'a refund marked processed with no Paystack refund');
  await prisma.providerRefund.update({ where: { id: leaverRefund.id }, data: { providerRefundId: sent.providerRefundId } });

  const stray = await prisma.matchCredit.create({ data: { userId: leaver, reason: 'GOODWILL', expiresAt: new Date(Date.now() + 3 * 366 * 86_400_000) } });
  await detects('CREDIT_LEDGER_MISMATCH', 'a match credit with no ledger entry');
  await prisma.matchCredit.delete({ where: { id: stray.id } });

  const ghost = await bookings.createQuickMatch({ managedFieldId: venue.fields[0]!.id, name: `${marker}-ghost`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 5, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: new Date(kickoff.getTime() + 86_400_000).toISOString() }, hostId);
  matchIds.push(ghost.id);
  await prisma.match.update({ where: { id: ghost.id }, data: { status: 'IN_PROGRESS', confirmedAt: new Date() } });
  await detects('STARTED_MATCH_WITHOUT_PAYABLE', 'match that went ahead with no payable');
  await prisma.match.update({ where: { id: ghost.id }, data: { status: 'OPEN', confirmedAt: null } });

  assert((await ourIssues()).length === 0, 'Reverted fixtures do not reconcile to zero again.');
  console.log('Payment-to-settlement E2E passed: R80 match tickets confirmed by signed webhooks, a leaver refunded to the card, a won chargeback that restricted and then released bookings, T-30 confirmation, kickoff payable, dual-control weekly payout, zero ticket reconciliation issues, and every injected inconsistency detected.');
}

/** Paid settlement records are immutable, so the played match, venue, host and admins are retained. */
async function cleanup() {
  await referee.cleanupJobs(matchIds);
  await removeTicketJobsSince(smokeStartedAt);
  const events = await prisma.paymentWebhookEvent.findMany({ where: { receivedAt: { gte: startedAt } }, select: { id: true } });
  await prisma.durableJob.deleteMany({ where: { dedupeKey: { in: events.map(({ id }) => `paystack-webhook:${id}`) } } });
  await prisma.paymentWebhookEvent.deleteMany({ where: { id: { in: events.map(({ id }) => id) } } });
  await prisma.providerDispute.deleteMany({ where: { providerPayment: { userId: { in: userIds } } } });
  await removeTicketRows(matchIds);
  const ghostIds = matchIds.slice(1);
  const reservationIds = (await prisma.fieldReservation.findMany({ where: { matchId: { in: ghostIds } }, select: { id: true } })).map(({ id }) => id);
  await prisma.durableJob.deleteMany({ where: { OR: [...matchIds.map((id) => ({ dedupeKey: goNoGoJobDedupeKey(id) })), ...matchIds.map((id) => ({ dedupeKey: fillReminderJobDedupeKey(id) })), ...reservationIds.map((id) => ({ dedupeKey: `reservation-expire:${id}` }))] } });
  await prisma.fieldReservation.deleteMany({ where: { id: { in: reservationIds } } });
  const ghostVenueIds = (await prisma.match.findMany({ where: { id: { in: ghostIds } }, select: { venueId: true } })).map(({ venueId: id }) => id);
  await prisma.match.deleteMany({ where: { id: { in: ghostIds } } });
  await prisma.venue.deleteMany({ where: { id: { in: ghostVenueIds } } });
  const players = userIds.filter((id) => id !== hostId);
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  // Gate 8: the retained paid match keeps its kickoff lineup record; drop the entries of the players removed here.
  await prisma.matchLineupEntry.deleteMany({ where: { userId: { in: players } } });
  await prisma.user.deleteMany({ where: { id: { in: players } } });
  await referee.cleanup();
  await fake.stop();
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
