import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { serializableTransaction } from '../src/database/transaction.js';
import { CardRefundsService } from '../src/modules/payments/card-refunds.service.js';
import { PaystackClient } from '../src/modules/payments/paystack.client.js';
import { TopUpService } from '../src/modules/payments/top-up.service.js';
import { TopUpSettlementService } from '../src/modules/payments/top-up-settlement.service.js';
import { TopUpUndoService } from '../src/modules/payments/top-up-undo.service.js';
import { FinancialRepository } from '../src/modules/wallet/financial.repository.js';
import { FAKE_PAYSTACK_SECRET, FakePaystack } from './support/fake-paystack-server.js';

/**
 * CEO touch-up batch 3, item 6b on PostgreSQL with a fake Paystack: a player undoes a recent top-up back to the
 * same card. The unspent part only (D7), once per top-up, idempotent and race-safe; a failed Paystack refund stays
 * FAILED (never silently re-credited); restricted wallets, expired top-ups and other players' top-ups are refused.
 */
const marker = `undo-${randomUUID()}`;
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
const topUps = new TopUpService(gateway, settlement, undefined, { clientUrl: 'http://localhost:5173', expiryMinutes: 60, paystackEnabled: () => true });
const undo = new TopUpUndoService(new CardRefundsService(gateway));
const financial = new FinancialRepository();
const userIds: string[] = [];

const createUser = async (suffix: string) => {
  const user = await prisma.user.create({
    data: { email: `${marker}-${suffix}@smoke.invalid`, username: `u_${suffix}_${marker.slice(-12)}`, passwordHash: 'smoke', profile: { create: { displayName: `Undo ${suffix}` } }, walletAccount: { create: {} } },
  });
  userIds.push(user.id);
  return user.id;
};
const balance = async (userId: string) => (await prisma.walletAccount.findUniqueOrThrow({ where: { userId } })).balanceCents;
/** A paid, credited card top-up; returns its ProviderPayment id. */
const topUp = async (userId: string, amountCents: number) => {
  const started = await topUps.initiate(userId, amountCents, `${marker}-${randomUUID()}`);
  fake.pay(started.reference);
  await settlement.settleFromVerify(started.reference, 'webhook');
  return (await prisma.providerPayment.findUniqueOrThrow({ where: { reference: started.reference } })).id;
};
const spend = (userId: string, amountCents: number) =>
  serializableTransaction((tx) => financial.debit(tx, { userId, amountCents, type: 'MATCH_ENTRY_DEBIT', idempotencyKey: `${marker}-spend-${randomUUID()}`, referenceType: 'MATCH', referenceId: randomUUID(), description: 'Smoke match fee' }));

try {
  // R100, then a R800 top-up (R900), then a R80 match: undo returns up to R720 (D7).
  const player = await createUser('a');
  const small = await topUp(player, 10_000);
  const big = await topUp(player, 80_000);
  await spend(player, 8_000);
  assert((await balance(player)) === 82_000, 'Setup balance is wrong.');
  const listed = await undo.undoable(player);
  const bigRow = listed.find(({ paymentId }) => paymentId === big);
  assert(bigRow?.refundableCents === 72_000 && bigRow.blockedReason === null, `Expected R720 undoable, got ${bigRow?.refundableCents}.`);
  assert(listed.find(({ paymentId }) => paymentId === small)?.refundableCents === 2_000, 'The earlier top-up should only have R20 unspent.');
  assert((await code(undo.undo(player, big, 72_001, `${marker}-too-much`))) === 'REFUND_EXCEEDS_AVAILABLE', 'More than the unspent part was refundable.');

  // Double submit and a second device at once: exactly one refund and one Paystack call.
  const refundsBefore = fake.refunds.length;
  const race = await Promise.allSettled([
    undo.undo(player, big, 72_000, `${marker}-tap`),
    undo.undo(player, big, 72_000, `${marker}-tap`),
    undo.undo(player, big, 72_000, `${marker}-other-device`),
  ]);
  const fulfilled = race.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof undo.undo>>> => result.status === 'fulfilled');
  assert(fulfilled.length >= 1 && new Set(fulfilled.map(({ value }) => value.id)).size === 1, 'The race created more than one refund.');
  for (const result of race)
    if (result.status === 'rejected') assert(['TOP_UP_ALREADY_UNDONE'].includes((result.reason as { code?: string }).code ?? ''), `A racing undo failed for the wrong reason: ${String(result.reason)}`);
  assert(fake.refunds.length === refundsBefore + 1, 'Paystack was asked to refund more than once.');
  assert((await prisma.providerRefund.count({ where: { providerPaymentId: big, source: 'PLAYER_UNDO' } })) === 1, 'More than one undo was recorded.');
  assert((await balance(player)) === 10_000, 'The wallet was not debited exactly once.');
  assert((await code(undo.undo(player, big, 1_000, `${marker}-again`))) === 'TOP_UP_ALREADY_UNDONE', 'A top-up was undone twice.');
  assert((await undo.undoable(player)).find(({ paymentId }) => paymentId === big)?.blockedReason === 'ALREADY_UNDONE', 'The list does not show the top-up as undone.');

  // Someone else's top-up, and an expired one, are refused.
  const other = await createUser('b');
  assert((await code(undo.undo(other, small, 1_000, `${marker}-steal`))) === 'TOP_UP_NOT_FOUND', "A player could undo someone else's top-up.");
  assert((await code(undo.undo(player, small, 1_000, `${marker}-late`, new Date(Date.now() + 25 * 3_600_000)))) === 'TOP_UP_UNDO_EXPIRED', 'An undo after 24 hours was accepted.');

  // A failed Paystack refund stays FAILED and is never silently re-credited (the Gate 6 path).
  const second = await createUser('c');
  const failing = await topUp(second, 50_000);
  fake.failNext = { path: 'refund', status: 500 };
  const failed = await undo.undo(second, failing, 20_000, `${marker}-fails`);
  assert(failed.status === 'FAILED', 'A failed Paystack refund was not left FAILED.');
  assert((await balance(second)) === 30_000, 'A failed refund was re-credited to the wallet.');

  // A restricted wallet cannot undo.
  const third = await createUser('d');
  const blockedTopUp = await topUp(third, 20_000);
  await prisma.walletAccount.update({ where: { userId: third }, data: { spendingRestrictedAt: new Date(), spendingRestrictionReason: 'Smoke chargeback' } });
  assert((await code(undo.undo(third, blockedTopUp, 5_000, `${marker}-restricted`))) === 'WALLET_RESTRICTED', 'A restricted wallet undid a top-up.');

  for (const userId of userIds) {
    const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { userId } });
    const ledger = await prisma.walletTransaction.aggregate({ where: { walletAccountId: wallet.id, status: 'SUCCEEDED' }, _sum: { amountCents: true } });
    assert((ledger._sum.amountCents ?? 0) === wallet.balanceCents, 'A wallet does not reconcile to its ledger.');
  }
  console.log('Top-up undo smoke passed: only the unspent part (R720 of R800 after a R80 match), double-submit and two-device race give one refund and one Paystack call, once per top-up, other players and expired top-ups refused, a failed Paystack refund stays FAILED without re-credit, restricted wallets refused, wallets reconcile.');
} finally {
  const payments = await prisma.providerPayment.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  for (const { id } of payments) await prisma.durableJob.deleteMany({ where: { dedupeKey: { startsWith: `paystack-topup-expire:${id}` } } });
  await prisma.providerRefund.deleteMany({ where: { providerPayment: { userId: { in: userIds } } } });
  await prisma.providerPayment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.walletTransaction.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await fake.stop();
  await prisma.$disconnect();
}
