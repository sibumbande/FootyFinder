import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { prisma } from '../src/database/prisma.js';
import { PaystackClient } from '../src/modules/payments/paystack.client.js';
import { createPaystackWebhookRouter } from '../src/modules/payments/paystack-webhook.js';
import { PaystackWebhookProcessor } from '../src/modules/payments/paystack-webhook.jobs.js';
import { runTopUpExpiry } from '../src/modules/payments/top-up.jobs.js';
import { TopUpService } from '../src/modules/payments/top-up.service.js';
import { TopUpSettlementService } from '../src/modules/payments/top-up-settlement.service.js';
import { WalletHistoryService } from '../src/modules/wallet/wallet-history.service.js';
import { FAKE_PAYSTACK_SECRET, FakePaystack } from './support/fake-paystack-server.js';

/**
 * Gate 6 payments smoke (real PostgreSQL, fake Paystack over HTTP):
 * TKT-604 initiation/idempotency/status-check/expiry, and the D11 rule that the webhook, the
 * expiry job and the status check share one credit path that can never credit twice.
 */
const marker = `gate6-pay-${randomUUID()}`;
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

const fake = await new FakePaystack().start();
const gateway = new PaystackClient({ secretKey: FAKE_PAYSTACK_SECRET, baseUrl: fake.baseUrl });
const settlement = new TopUpSettlementService(gateway);
const topUps = new TopUpService(gateway, settlement, undefined, {
  clientUrl: 'http://localhost:5173',
  expiryMinutes: 60,
  paystackEnabled: () => true,
});
const history = new WalletHistoryService();
const processor = new PaystackWebhookProcessor(settlement);
const startedAt = new Date();
const userIds: string[] = [];

const createUser = async (suffix: string) => {
  const user = await prisma.user.create({
    data: {
      email: `${marker}-${suffix}@smoke.invalid`,
      username: `p_${suffix}_${marker.slice(-12)}`,
      passwordHash: 'smoke',
      profile: { create: { displayName: `Payments ${suffix}` } },
      walletAccount: { create: {} },
    },
  });
  userIds.push(user.id);
  return user.id;
};
const balance = async (userId: string) => (await prisma.walletAccount.findUniqueOrThrow({ where: { userId } })).balanceCents;
const credits = async (userId: string) =>
  prisma.walletTransaction.count({ where: { walletAccount: { userId }, type: 'DEPOSIT_CREDIT', status: 'SUCCEEDED' } });
const payment = (reference: string) => prisma.providerPayment.findUniqueOrThrow({ where: { reference } });
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);

try {
  const player = await createUser('a');

  // --- Initiation is idempotent and never credits -----------------------------------------
  const key = `${marker}-key-1`;
  const concurrent = await Promise.allSettled([
    topUps.initiate(player, 16_000, key),
    topUps.initiate(player, 16_000, key),
  ]);
  assert(concurrent.some((result) => result.status === 'fulfilled'), 'No concurrent initiation succeeded.');
  for (const result of concurrent)
    if (result.status === 'rejected')
      assert((result.reason as { code?: string }).code === 'TOP_UP_IN_PROGRESS', 'A concurrent initiation failed for the wrong reason.');
  const first = await topUps.initiate(player, 16_000, key);
  assert(first.authorizationUrl?.startsWith('https://checkout.paystack.com/'), 'Initiation returned no hosted checkout URL.');
  assert((await prisma.providerPayment.count({ where: { userId: player } })) === 1, 'One idempotency key created more than one top-up.');
  assert(fake.calls.initialize === 1, 'Paystack initialize was called more than once for one key.');
  assert((await code(topUps.initiate(player, 24_000, key))) === 'IDEMPOTENCY_KEY_REUSED', 'Reusing a key for another amount was accepted.');
  assert((await balance(player)) === 0, 'Starting a top-up credited the wallet.');
  const pendingRow = (await history.history(player, { limit: 20 })).entries[0];
  assert(pendingRow?.status === 'PENDING' && !pendingRow.countsTowardsBalance, 'Pending top-up is not shown as pending in history.');
  assert((await prisma.durableJob.count({ where: { dedupeKey: { startsWith: `paystack-topup-expire:${(await payment(first.reference)).id}` } } })) === 1, 'Expiry job was not enqueued.');

  // --- Status check while the checkout is open: no credit, throttled verify ---------------
  const verifyBefore = fake.calls.verify;
  const open = await topUps.status(player, first.reference, later(0));
  assert(open.state === 'PROCESSING' && (await balance(player)) === 0, 'Open checkout was treated as paid.');
  await topUps.status(player, first.reference, later(1));
  assert(fake.calls.verify === verifyBefore + 1, 'Status check re-verified inside the 5 s throttle.');
  assert((await code(topUps.status(await createUser('b'), first.reference))) === 'TOP_UP_NOT_FOUND', "Another player could read someone else's top-up.");

  // --- Paid: status check credits through the shared path; others replay -------------------
  fake.pay(first.reference);
  const paid = await topUps.status(player, first.reference, later(10));
  assert(paid.state === 'SUCCEEDED', 'Verified success was not credited by the status check.');
  assert((await balance(player)) === 16_000 && (await credits(player)) === 1, 'Status check credit was wrong.');
  assert((await payment(first.reference)).creditedBy === 'status_check', 'creditedBy not recorded.');
  const replays = await Promise.all([
    settlement.settleFromVerify(first.reference, 'webhook'),
    settlement.settleFromVerify(first.reference, 'expiry_job'),
  ]);
  assert(replays.every((result) => !result.credited), 'A later source credited an already-credited top-up.');
  await runTopUpExpiry({ providerPaymentId: (await payment(first.reference)).id, attempt: 0 }, settlement);
  assert((await balance(player)) === 16_000 && (await credits(player)) === 1, 'Top-up was credited twice.');
  assert((await prisma.notification.count({ where: { userId: player, type: 'DEPOSIT_SUCCEEDED' } })) === 1, 'Deposit notification not exactly once.');

  // --- Three sources at once on a freshly paid top-up: exactly one credit -----------------
  for (let round = 0; round < 3; round += 1) {
    const race = await topUps.initiate(player, 8_000, `${marker}-race-${round}`);
    fake.pay(race.reference);
    const results = await Promise.all([
      settlement.settleFromVerify(race.reference, 'webhook'),
      settlement.settleFromVerify(race.reference, 'expiry_job'),
      settlement.settleFromVerify(race.reference, 'status_check'),
    ]);
    assert(results.filter((result) => result.credited).length === 1, `Race round ${round} credited ${results.filter((r) => r.credited).length} times.`);
  }
  assert((await balance(player)) === 16_000 + 3 * 8_000, 'Race rounds left the wrong balance.');

  // --- Mismatch goes to review, never credit ------------------------------------------------
  const mismatch = await topUps.initiate(player, 5_000, `${marker}-mismatch`);
  fake.pay(mismatch.reference, { amount: 4_900 });
  await settlement.settleFromVerify(mismatch.reference, 'webhook');
  assert((await payment(mismatch.reference)).status === 'REVIEW', 'Amount mismatch was not sent to review.');
  const reviewStatus = await topUps.status(player, mismatch.reference, later(20));
  assert(reviewStatus.state === 'PROCESSING' && reviewStatus.underReview, 'Review top-up shown wrongly to the player.');

  // --- Abandoned past max age fails; a late success afterwards goes to review -------------
  const abandoned = await topUps.initiate(player, 5_000, `${marker}-abandoned`);
  fake.pay(abandoned.reference, { status: 'abandoned' });
  await runTopUpExpiry({ providerPaymentId: (await payment(abandoned.reference)).id, attempt: 0 }, settlement, later(60));
  assert((await payment(abandoned.reference)).status === 'INITIALIZED', 'Abandoned checkout closed before the max age.');
  assert((await prisma.durableJob.count({ where: { dedupeKey: `paystack-topup-expire:${(await payment(abandoned.reference)).id}:1` } })) === 1, 'Open top-up was not re-checked later.');
  await runTopUpExpiry({ providerPaymentId: (await payment(abandoned.reference)).id, attempt: 1 }, settlement, later(25 * 3600));
  assert((await payment(abandoned.reference)).status === 'FAILED', 'Abandoned checkout was not closed at max age.');
  fake.pay(abandoned.reference);
  await settlement.settleFromVerify(abandoned.reference, 'webhook');
  assert((await payment(abandoned.reference)).status === 'REVIEW', 'Late success after failure was not sent to review.');
  const beforeFailure = await balance(player);

  // --- Provider unavailable at initiation: closed, no credit ------------------------------
  fake.failNext = { path: 'initialize', status: 500 };
  assert((await code(topUps.initiate(player, 5_000, `${marker}-down`))) === 'PAYMENT_PROVIDER_UNAVAILABLE', 'Provider outage was not reported.');
  const down = await prisma.providerPayment.findFirstOrThrow({ where: { userId: player, walletTransaction: { idempotencyKey: `paystack-topup:${player}:${marker}-down` } } });
  assert(down.status === 'FAILED', 'Failed initiation left the top-up open.');
  assert((await prisma.walletTransaction.findUniqueOrThrow({ where: { id: down.walletTransactionId } })).status === 'ERROR', 'Failed initiation ledger row not closed.');
  assert((await balance(player)) === beforeFailure, 'A failed top-up changed the balance.');

  // --- TKT-605 webhooks: authenticated, stored once, processed through the same path --------
  const hook = express().use(
    '/payments',
    createPaystackWebhookRouter({ secret: () => FAKE_PAYSTACK_SECRET, ipAllowlist: () => [] }),
  );
  const deliver = (raw: string, signature: string) =>
    request(hook).post('/payments/paystack/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', signature).send(raw);
  const eventFor = async (reference: string) =>
    prisma.paymentWebhookEvent.findMany({ where: { reference, signatureValid: true } });
  const processAll = async (reference: string) => {
    for (const event of await eventFor(reference)) await processor.process(event.id);
  };
  const buyer = await createUser('c');

  // Webhook first, then the status check: one credit. Three identical deliveries at once.
  const w1 = await topUps.initiate(buyer, 16_000, `${marker}-w1`);
  fake.pay(w1.reference);
  const e1 = fake.signedEvent('charge.success', { reference: w1.reference, amount: 16_000 });
  const deliveries = await Promise.all([deliver(e1.raw, e1.signature), deliver(e1.raw, e1.signature), deliver(e1.raw, e1.signature)]);
  assert(deliveries.every((response) => response.status === 200), 'A valid webhook delivery was not acknowledged.');
  assert((await eventFor(w1.reference)).length === 1, 'Replayed webhook stored more than one event.');
  const w1Event = (await eventFor(w1.reference))[0]!;
  assert((await prisma.durableJob.count({ where: { dedupeKey: `paystack-webhook:${w1Event.id}` } })) === 1, 'Webhook job not enqueued exactly once.');
  assert((await balance(buyer)) === 0, 'The webhook receiver credited before verification.');
  await processAll(w1.reference);
  await processAll(w1.reference);
  await topUps.status(buyer, w1.reference, later(30));
  assert((await balance(buyer)) === 16_000 && (await credits(buyer)) === 1, 'Webhook-then-verify credited more than once.');
  assert((await payment(w1.reference)).creditedBy === 'webhook', 'Webhook credit not attributed to the webhook.');
  assert((await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: w1Event.id } })).outcome === 'charge_credit', 'Webhook outcome not recorded.');

  // Status check first, then the webhook: one credit.
  const w2 = await topUps.initiate(buyer, 8_000, `${marker}-w2`);
  fake.pay(w2.reference);
  await topUps.status(buyer, w2.reference, later(40));
  const e2 = fake.signedEvent('charge.success', { reference: w2.reference });
  assert((await deliver(e2.raw, e2.signature)).status === 200, 'Late webhook not acknowledged.');
  await processAll(w2.reference);
  assert((await balance(buyer)) === 24_000 && (await credits(buyer)) === 2, 'Verify-then-webhook credited more than once.');
  assert((await eventFor(w2.reference))[0]!.outcome === 'charge_replayed', 'Late webhook was not a replay.');

  // Webhook processing, expiry job and status check all at once: one credit.
  const w3 = await topUps.initiate(buyer, 8_000, `${marker}-w3`);
  fake.pay(w3.reference);
  const e3 = fake.signedEvent('charge.success', { reference: w3.reference });
  await deliver(e3.raw, e3.signature);
  const w3Payment = await payment(w3.reference);
  await Promise.all([
    processAll(w3.reference),
    runTopUpExpiry({ providerPaymentId: w3Payment.id, attempt: 0 }, settlement),
    topUps.status(buyer, w3.reference, later(50)),
  ]);
  assert((await balance(buyer)) === 32_000 && (await credits(buyer)) === 3, 'Concurrent webhook/expiry/status credited more than once.');

  // Bad signature: rejected, audited without payload, nothing enqueued or credited.
  const w4 = await topUps.initiate(buyer, 5_000, `${marker}-w4`);
  fake.pay(w4.reference);
  const forged = fake.signedEvent('charge.success', { reference: w4.reference }, 'sk_test_attacker-key');
  assert((await deliver(forged.raw, forged.signature)).status === 401, 'Forged webhook was accepted.');
  assert((await eventFor(w4.reference)).length === 0, 'Forged webhook was stored as valid.');
  assert((await prisma.paymentWebhookEvent.count({ where: { signatureValid: false, outcome: 'invalid_signature', receivedAt: { gte: startedAt } } })) >= 1, 'Forged webhook was not audited.');
  assert((await balance(buyer)) === 32_000, 'Forged webhook changed the balance.');

  // Provider timeout while processing: the job fails and retries; the retry credits once.
  const e4 = fake.signedEvent('charge.success', { reference: w4.reference });
  await deliver(e4.raw, e4.signature);
  const w4Event = (await eventFor(w4.reference))[0]!;
  fake.failNext = { path: 'verify', status: 503 };
  assert((await code(processor.process(w4Event.id))) === 'PAYSTACK_UNAVAILABLE', 'Provider outage during processing was swallowed.');
  assert((await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: w4Event.id } })).processedAt === null, 'Failed processing was marked done.');
  await processor.process(w4Event.id);
  assert((await balance(buyer)) === 37_000 && (await credits(buyer)) === 4, 'Retried webhook did not credit exactly once.');

  // Unknown references and unrelated events are recorded and ignored.
  const stray = fake.signedEvent('charge.success', { reference: 'ff_topup_ffffffffffffffffffffffffffffffff' });
  await deliver(stray.raw, stray.signature);
  await processAll('ff_topup_ffffffffffffffffffffffffffffffff');
  assert((await eventFor('ff_topup_ffffffffffffffffffffffffffffffff'))[0]!.outcome === 'unknown_reference', 'Unknown reference not recorded.');

  // Out of order: success arrives by webhook after the top-up was closed as abandoned.
  const w5 = await topUps.initiate(buyer, 5_000, `${marker}-w5`);
  fake.pay(w5.reference, { status: 'abandoned' });
  await runTopUpExpiry({ providerPaymentId: (await payment(w5.reference)).id, attempt: 9 }, settlement, later(25 * 3600));
  fake.pay(w5.reference);
  const e5 = fake.signedEvent('charge.success', { reference: w5.reference });
  await deliver(e5.raw, e5.signature);
  await processAll(w5.reference);
  assert((await payment(w5.reference)).status === 'REVIEW' && (await balance(buyer)) === 37_000, 'Late webhook after closure was credited instead of reviewed.');

  // --- Reconciliation: balance equals the settled ledger ----------------------------------
  for (const userId of userIds) {
    const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { userId } });
    const ledger = await prisma.walletTransaction.aggregate({ where: { walletAccountId: wallet.id, status: 'SUCCEEDED' }, _sum: { amountCents: true } });
    assert((ledger._sum.amountCents ?? 0) === wallet.balanceCents, 'Wallet does not reconcile to its ledger.');
  }
} finally {
  const payments = await prisma.providerPayment.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  for (const { id } of payments) await prisma.durableJob.deleteMany({ where: { dedupeKey: { startsWith: `paystack-topup-expire:${id}` } } });
  const events = await prisma.paymentWebhookEvent.findMany({ where: { receivedAt: { gte: startedAt } }, select: { id: true } });
  await prisma.durableJob.deleteMany({ where: { dedupeKey: { in: events.map(({ id }) => `paystack-webhook:${id}`) } } });
  await prisma.paymentWebhookEvent.deleteMany({ where: { id: { in: events.map(({ id }) => id) } } });
  await prisma.providerPayment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.walletTransaction.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  assert((await prisma.user.count({ where: { email: { startsWith: marker } } })) === 0, 'Payments smoke users remained.');
  await fake.stop();
  await prisma.$disconnect();
}
console.log('Gate 6 payments smoke passed: idempotent initiation, throttled status check, authenticated deduplicated webhooks, single credit across webhook/expiry/status sources in every order, review and failure paths, reconciliation.');
