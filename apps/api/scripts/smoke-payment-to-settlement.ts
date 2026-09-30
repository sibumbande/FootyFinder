import './assert-disposable-test-database.js';
import { refereeFixture } from './referee-fixture.js';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import type { WalletReconciliationIssue } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { fillReminderJobDedupeKey } from '../src/modules/matches/fill-reminder.js';
import { goNoGoJobDedupeKey } from '../src/modules/matches/go-no-go.js';
import { transitionMatchToStarted } from '../src/modules/matches/match-lifecycle.scheduler.js';
import { MatchesRepository } from '../src/modules/matches/matches.repository.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { CardRefundsService } from '../src/modules/payments/card-refunds.service.js';
import { PaystackClient } from '../src/modules/payments/paystack.client.js';
import { createPaystackWebhookRouter } from '../src/modules/payments/paystack-webhook.js';
import { PaystackWebhookProcessor } from '../src/modules/payments/paystack-webhook.jobs.js';
import { TopUpService } from '../src/modules/payments/top-up.service.js';
import { TopUpSettlementService } from '../src/modules/payments/top-up-settlement.service.js';
import { SettlementBatchesService } from '../src/modules/settlement/settlement-batches.service.js';
import { settlementWeekOf } from '../src/modules/settlement/settlement-week.js';
import { VenueSettlementService } from '../src/modules/settlement/venue-settlement.service.js';
import { WalletReconciliationService } from '../src/modules/wallet/wallet-reconciliation.service.js';
import { FAKE_PAYSTACK_SECRET, FakePaystack } from './support/fake-paystack-server.js';

/**
 * TKT-609 payment-to-settlement E2E on real PostgreSQL with a fake Paystack over HTTP:
 * card top-ups credited by signed webhooks -> R80 joins -> T-30 confirmed -> kickoff payable ->
 * card refund and chargeback -> weekly dual-control settlement paid -> reconciliation finds zero
 * issues for these fixtures, and every injected inconsistency is detected.
 */
const marker = `gate6-e2e-${randomUUID()}`;
// Gate 8: a match also needs an active referee to be confirmed at T-30 (DEC-020).
const referee = refereeFixture(marker);
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const fake = await new FakePaystack().start();
const gateway = new PaystackClient({ secretKey: FAKE_PAYSTACK_SECRET, baseUrl: fake.baseUrl });
const settlementService = new TopUpSettlementService(gateway);
const topUps = new TopUpService(gateway, settlementService, undefined, { clientUrl: 'http://localhost:5173', expiryMinutes: 60, paystackEnabled: () => true });
const refunds = new CardRefundsService(gateway);
const processor = new PaystackWebhookProcessor(settlementService, refunds);
const hook = express().use('/payments', createPaystackWebhookRouter({ secret: () => FAKE_PAYSTACK_SECRET, ipAllowlist: () => [] }));
const bookings = new BookingsService();
const matches = new MatchesRepository();
const matchService = new MatchesService();
const venues = new VenueSettlementService();
const batches = new SettlementBatchesService();
const reconciliation = new WalletReconciliationService();
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
  for (const row of await prisma.providerPayment.findMany({ where: { userId: { in: userIds } }, select: { id: true } })) ids.add(row.id);
  for (const row of await prisma.providerRefund.findMany({ where: { providerPayment: { userId: { in: userIds } } }, select: { id: true } })) ids.add(row.id);
  for (const row of await prisma.providerDispute.findMany({ where: { providerPayment: { userId: { in: userIds } } }, select: { id: true } })) ids.add(row.id);
  for (const row of await prisma.venuePayable.findMany({ where: { matchId: { in: matchIds } }, select: { id: true } })) ids.add(row.id);
  for (const row of await prisma.venueSettlementBatch.findMany({ where: { venueId }, select: { id: true } })) ids.add(row.id);
  const wallets = await prisma.walletAccount.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  for (const row of wallets) ids.add(row.id);
  return report.issues.filter((issue: WalletReconciliationIssue) =>
    [issue.userId, issue.referenceId, issue.walletAccountId].some((value) => value && ids.has(value)),
  );
};
const detects = async (code: string, label: string) => {
  const issues = await ourIssues();
  assert(issues.some((issue) => issue.code === code), `Injected ${label} was not detected (${code}). Got: ${issues.map((i) => i.code).join(',')}`);
};

async function main() {
  const users = await Promise.all(
    Array.from({ length: 11 }, (_, index) =>
      prisma.user.create({
        data: {
          email: `${marker}-${index}@smoke.invalid`,
          username: `${marker.slice(-16)}_${index}`,
          passwordHash: 'smoke',
          profile: { create: { displayName: `E2E ${index}` } },
          walletAccount: { create: {} },
        },
      }),
    ),
  );
  userIds.push(...users.map(({ id }) => id));
  hostId = userIds[0]!;
  const players = userIds.slice(1);
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

  // 1. Every player tops up R160 by card; only the verified webhook path credits.
  const references = new Map<string, string>();
  for (const player of players) {
    const topUp = await topUps.initiate(player, 16_000, `${marker}-${player}`);
    fake.pay(topUp.reference);
    references.set(player, topUp.reference);
    await deliver('charge.success', { reference: topUp.reference, amount: 16_000 });
  }
  for (const player of players)
    assert((await prisma.walletAccount.findUniqueOrThrow({ where: { userId: player } })).balanceCents === 16_000, 'Top-up not credited exactly once.');

  // 2. Ten R80 joins, full lineup, confirmed at T-30, kicks off -> one payable from the snapshot.
  const kickoff = new Date(Date.now() + 4 * 86_400_000);
  kickoff.setUTCHours(10, 0, 0, 0);
  const match = await bookings.createQuickMatch({ managedFieldId: venue.fields[0]!.id, name: marker, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 5, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: kickoff.toISOString() }, hostId);
  matchIds.push(match.id);
  await referee.assign(match.id);
  const slots = await prisma.formationSlot.findMany({ where: { matchId: match.id }, orderBy: [{ team: 'asc' }, { slotIndex: 'asc' }] });
  for (const [index, player] of players.entries()) {
    const team = index % 2 === 0 ? 'HOME' : 'AWAY';
    await matches.join(match.id, player, { team }, `${marker}:join:${player}`);
    await matches.claimPosition(match.id, slots.filter((slot) => slot.team === team)[Math.floor(index / 2)]!.id, player);
  }
  const record = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
  assert((await matchService.decideGoNoGo(match.id, record.goNoGoAt!)).outcome === 'CONFIRMED', 'Match not confirmed.');
  assert(await transitionMatchToStarted(match.id), 'Match did not kick off.');
  const payable = await prisma.venuePayable.findUniqueOrThrow({ where: { matchId: match.id } });
  assert(payable.amountCents === 50_000, 'Payable is not the venue cost snapshot.');

  // 3. A card refund of unspent credit (processed) and a chargeback that is won.
  const refundPlayer = players[0]!;
  const refundPayment = await prisma.providerPayment.findUniqueOrThrow({ where: { reference: references.get(refundPlayer)! } });
  await refunds.initiate({ actorUserId: adminA, providerPaymentId: refundPayment.id, amountCents: 8_000, reason: 'Player asked for unspent credit back', idempotencyKey: `${marker}-refund` });
  await deliver('refund.processed', { transaction_reference: refundPayment.reference, amount: 8_000, status: 'processed' });
  const disputePlayer = players[1]!;
  const disputeReference = references.get(disputePlayer)!;
  await deliver('charge.dispute.create', { id: 990_001, refund_amount: 16_000, transaction: { reference: disputeReference, amount: 16_000 } });
  const restricted = await prisma.walletAccount.findUniqueOrThrow({ where: { userId: disputePlayer } });
  assert(restricted.balanceCents === -8_000 && restricted.spendingRestrictedAt, 'Chargeback not reversed below zero with restriction.');
  await deliver('charge.dispute.resolve', { id: 990_001, resolution: 'declined', status: 'resolved', transaction: { reference: disputeReference } });
  assert((await prisma.walletAccount.findUniqueOrThrow({ where: { userId: disputePlayer } })).balanceCents === 8_000, 'Won dispute not restored.');

  // 4. Weekly dual-control settlement with fake bank details.
  const beneficiary = await venues.createBeneficiary(adminA, venueId, { displayName: 'E2E Venue Trust (fake)', details: { bankName: 'Test Bank (fake)', accountHolder: 'E2E Venue Trust (fake)', accountNumber: '62000000009', branchCode: '250655', accountType: 'CHEQUE' } });
  await venues.approveBeneficiary(adminB, beneficiary.id);
  const afterWeek = new Date(kickoff.getTime() + 14 * 86_400_000);
  const batch = await batches.prepare(adminA, { venueId, weekStart: settlementWeekOf(kickoff) }, marker, afterWeek);
  await batches.approve(adminB, batch.id);
  const paid = await batches.markPaid(adminB, batch.id, { payoutReference: `${marker}-eft`, evidenceNote: 'EFT confirmation (fake)' });
  assert(paid.status === 'PAID' && paid.totalCents === 50_000, 'Settlement not paid for the venue cost.');

  // 5. Known fixtures reconcile to zero issues.
  const clean = await ourIssues();
  assert(clean.length === 0, `Reconciliation found issues in clean fixtures: ${JSON.stringify(clean)}`);

  // 6. Injected inconsistencies are detected (each is reverted afterwards).
  const victim = players[2]!;
  await prisma.walletAccount.update({ where: { userId: victim }, data: { balanceCents: { increment: 1 } } });
  await detects('BALANCE_LEDGER_MISMATCH', 'direct balance edit');
  await prisma.walletAccount.update({ where: { userId: victim }, data: { balanceCents: { decrement: 1 } } });

  const victimPayment = await prisma.providerPayment.findUniqueOrThrow({ where: { reference: references.get(victim)! } });
  await prisma.providerPayment.update({ where: { id: victimPayment.id }, data: { status: 'INITIALIZED' } });
  await detects('TOP_UP_CREDIT_WITHOUT_VERIFIED_PAYMENT', 'credit without verified payment');
  await prisma.providerPayment.update({ where: { id: victimPayment.id }, data: { status: 'SUCCEEDED' } });

  const reservation = await prisma.fieldReservation.findUniqueOrThrow({ where: { matchId: match.id } });
  await prisma.fieldReservation.update({ where: { id: reservation.id }, data: { priceCentsSnapshot: 60_000 } });
  await detects('PAYABLE_AMOUNT_MISMATCH', 'payable not equal to the snapshot');
  await prisma.fieldReservation.update({ where: { id: reservation.id }, data: { priceCentsSnapshot: 50_000 } });

  const refund = await prisma.providerRefund.findFirstOrThrow({ where: { providerPaymentId: refundPayment.id } });
  await prisma.providerRefund.update({ where: { id: refund.id }, data: { amountCents: 17_000 } });
  await detects('REFUND_LEDGER_MISMATCH', 'refund not matching its ledger debit');
  await detects('REFUNDS_EXCEED_TOP_UP', 'refunds above the top-up');
  await prisma.providerRefund.update({ where: { id: refund.id }, data: { amountCents: 8_000 } });

  const ghost = await bookings.createQuickMatch({ managedFieldId: venue.fields[0]!.id, name: `${marker}-ghost`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 5, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: new Date(kickoff.getTime() + 86_400_000).toISOString() }, hostId);
  matchIds.push(ghost.id);
  await prisma.match.update({ where: { id: ghost.id }, data: { status: 'IN_PROGRESS', confirmedAt: new Date() } });
  await detects('STARTED_MATCH_WITHOUT_PAYABLE', 'match that went ahead with no payable');
  await prisma.match.update({ where: { id: ghost.id }, data: { status: 'OPEN', confirmedAt: null } });

  let unrestrictedNegative = false;
  await prisma.walletAccount.update({ where: { userId: victim }, data: { balanceCents: -1 } }).catch(() => (unrestrictedNegative = true));
  assert(unrestrictedNegative, 'DB allowed a negative unrestricted balance.');

  assert((await ourIssues()).length === 0, 'Reverted fixtures do not reconcile to zero again.');
  console.log('Gate 6 payment-to-settlement E2E passed: webhook-credited top-ups, R80 joins, T-30 confirmation, kickoff payable, card refund, won chargeback, dual-control weekly payout, zero reconciliation issues, and every injected inconsistency detected.');
}

/** Paid settlement records are immutable, so the played match, venue, host and admins are retained. */
async function cleanup() {
  await referee.cleanupJobs(matchIds);
  const events = await prisma.paymentWebhookEvent.findMany({ where: { receivedAt: { gte: startedAt } }, select: { id: true } });
  await prisma.durableJob.deleteMany({ where: { dedupeKey: { in: events.map(({ id }) => `paystack-webhook:${id}`) } } });
  await prisma.paymentWebhookEvent.deleteMany({ where: { id: { in: events.map(({ id }) => id) } } });
  const payments = await prisma.providerPayment.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  for (const { id } of payments) await prisma.durableJob.deleteMany({ where: { dedupeKey: { startsWith: `paystack-topup-expire:${id}` } } });
  await prisma.providerDispute.deleteMany({ where: { providerPayment: { userId: { in: userIds } } } });
  await prisma.providerRefund.deleteMany({ where: { providerPayment: { userId: { in: userIds } } } });
  await prisma.providerPayment.deleteMany({ where: { userId: { in: userIds } } });
  const ghostIds = matchIds.slice(1);
  const reservationIds = (await prisma.fieldReservation.findMany({ where: { matchId: { in: ghostIds } }, select: { id: true } })).map(({ id }) => id);
  await prisma.durableJob.deleteMany({ where: { OR: [...matchIds.map((id) => ({ dedupeKey: goNoGoJobDedupeKey(id) })), ...matchIds.map((id) => ({ dedupeKey: fillReminderJobDedupeKey(id) })), ...reservationIds.map((id) => ({ dedupeKey: `reservation-expire:${id}` }))] } });
  await prisma.fieldReservation.deleteMany({ where: { id: { in: reservationIds } } });
  const ghostVenueIds = (await prisma.match.findMany({ where: { id: { in: ghostIds } }, select: { venueId: true } })).map(({ venueId: id }) => id);
  await prisma.match.deleteMany({ where: { id: { in: ghostIds } } });
  await prisma.venue.deleteMany({ where: { id: { in: ghostVenueIds } } });
  const players = userIds.filter((id) => id !== hostId);
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.matchPayment.deleteMany({ where: { userId: { in: players } } });
  await prisma.walletTransaction.deleteMany({ where: { walletAccount: { userId: { in: players } } } });
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
