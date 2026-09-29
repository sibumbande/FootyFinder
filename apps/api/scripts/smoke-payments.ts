import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { PaystackClient } from '../src/modules/payments/paystack.client.js';
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

  // --- Reconciliation: balance equals the settled ledger ----------------------------------
  for (const userId of userIds) {
    const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { userId } });
    const ledger = await prisma.walletTransaction.aggregate({ where: { walletAccountId: wallet.id, status: 'SUCCEEDED' }, _sum: { amountCents: true } });
    assert((ledger._sum.amountCents ?? 0) === wallet.balanceCents, 'Wallet does not reconcile to its ledger.');
  }
} finally {
  const payments = await prisma.providerPayment.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  for (const { id } of payments) await prisma.durableJob.deleteMany({ where: { dedupeKey: { startsWith: `paystack-topup-expire:${id}` } } });
  await prisma.providerPayment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.walletTransaction.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  assert((await prisma.user.count({ where: { email: { startsWith: marker } } })) === 0, 'Payments smoke users remained.');
  await fake.stop();
  await prisma.$disconnect();
}
console.log('Gate 6 payments smoke passed: idempotent initiation, throttled status check, single credit across webhook/expiry/status sources, review and failure paths, reconciliation.');
