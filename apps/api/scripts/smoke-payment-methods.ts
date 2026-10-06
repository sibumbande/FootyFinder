import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { PAYMENT_CHANNELS } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { CardRefundsService } from '../src/modules/payments/card-refunds.service.js';
import { PaymentDisputesService } from '../src/modules/payments/payment-disputes.service.js';
import { PaystackClient } from '../src/modules/payments/paystack.client.js';
import { TopUpService } from '../src/modules/payments/top-up.service.js';
import { TopUpSettlementService } from '../src/modules/payments/top-up-settlement.service.js';
import { FAKE_PAYSTACK_SECRET, FakePaystack } from './support/fake-paystack-server.js';

/**
 * CEO touch-up batch 4, item 3 on PostgreSQL with a fake Paystack: checkout asks for exactly the switched-on methods
 * (card, Apple Pay, Capitec Pay, Instant EFT), top-ups through each are credited and a method that is not switched
 * on (QR) is parked for review; an admin refund of a bank payment that Paystack marks "needs attention" is
 * completed with the customer's bank account (sent to Paystack, never stored; audit keeps the last 4 digits) or returned to the wallet; chargebacks work
 * for a bank payment too.
 */
const marker = `methods-${randomUUID()}`;
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
const channels = [...PAYMENT_CHANNELS];
const fake = await new FakePaystack().start();
fake.expectedChannels = channels;
const gateway = new PaystackClient({ secretKey: FAKE_PAYSTACK_SECRET, baseUrl: fake.baseUrl, channels });
const settlement = new TopUpSettlementService(gateway, undefined, undefined, channels);
const topUps = new TopUpService(gateway, settlement, undefined, { clientUrl: 'http://localhost:5173', expiryMinutes: 60, paystackEnabled: () => true });
const refunds = new CardRefundsService(gateway);
const userIds: string[] = [];
let retainedAdmin = '';

const createUser = async (suffix: string) => {
  const user = await prisma.user.create({
    data: { email: `${marker}-${suffix}@smoke.invalid`, username: `m_${suffix}_${marker.slice(-12)}`, passwordHash: 'smoke', profile: { create: { displayName: `Methods ${suffix}` } }, walletAccount: { create: {} } },
  });
  userIds.push(user.id);
  return user.id;
};
const topUp = async (userId: string, amountCents: number, channel: string) => {
  const started = await topUps.initiate(userId, amountCents, `${marker}-${randomUUID()}`);
  fake.pay(started.reference, { channel });
  await settlement.settleFromVerify(started.reference, 'webhook');
  return prisma.providerPayment.findUniqueOrThrow({ where: { reference: started.reference } });
};

try {
  const player = await createUser('a');
  // One at a time: each credit is a serializable wallet write.
  const paid: Partial<Record<(typeof channels)[number], Awaited<ReturnType<typeof topUp>>>> = {};
  for (const channel of channels) paid[channel] = await topUp(player, 20_000, channel);
  for (const channel of channels) assert(paid[channel]!.status === 'SUCCEEDED' && paid[channel]!.channel === channel, `A ${channel} top-up was not credited.`);
  const qr = await topUp(player, 20_000, 'qr');
  assert(qr.status === 'REVIEW' && qr.reviewReason === 'channel_not_offered', 'A QR payment was credited although QR is not offered.');
  assert((await prisma.walletAccount.findUniqueOrThrow({ where: { userId: player } })).balanceCents === 80_000, 'The wallet is not R800 after four credited top-ups.');


  // Admin refund of an Instant EFT top-up: Paystack has no bank account, so it needs attention.
  const admin = await createUser('admin');
  userIds.splice(userIds.indexOf(admin), 1);
  retainedAdmin = admin;
  await prisma.user.update({ where: { id: admin }, data: { platformRole: 'ADMIN' } });
  fake.refundStatus = 'needs-attention';
  const eftRefund = await refunds.initiate({ actorUserId: admin, providerPaymentId: paid.eft!.id, amountCents: 20_000, reason: 'Account closure (support)', idempotencyKey: `${marker}-eft` });
  assert(eftRefund.status === 'NEEDS_ATTENTION', `The EFT refund is ${eftRefund.status}, not NEEDS_ATTENTION.`);
  assert((await prisma.notification.count({ where: { userId: player, title: 'Refund needs your bank details' } })) === 1, 'The player was not told the refund needs bank details.');
  const banks = await gateway.listBanks();
  assert(banks.some(({ name }) => name === 'Capitec Bank'), 'The bank list is empty.');
  const sent = await refunds.retryWithCustomerDetails({ actorUserId: admin, refundId: eftRefund.id, accountNumber: '1234567890', bankId: '140', bankName: 'Capitec Bank', requestId: marker });
  assert(sent.status === 'PROCESSING' && fake.calls.retry === 1, 'The bank details were not sent to Paystack.');
  assert(fake.refunds.find(({ id }) => String(id) === sent.providerRefundId)?.accountDetails?.account_number === '1234567890', 'Paystack did not receive the account number.');
  const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { requestId: marker, action: 'TOP_UP_REFUND_BANK_DETAILS_SENT' } });
  assert(JSON.stringify(audit.metadata) === JSON.stringify({ bankName: 'Capitec Bank', accountLast4: '7890' }), 'The audit kept more than the bank name and last 4 digits.');
  assert(!JSON.stringify(await prisma.providerRefund.findUniqueOrThrow({ where: { id: eftRefund.id } })).includes('1234567890'), 'The account number was stored.');

  // A Capitec Pay refund that needs attention can instead go back to the wallet.
  const capitecRefund = await refunds.initiate({ actorUserId: admin, providerPaymentId: paid.capitec_pay!.id, amountCents: 10_000, reason: 'Duplicate top-up', idempotencyKey: `${marker}-capitec` });
  assert(capitecRefund.status === 'NEEDS_ATTENTION', 'The Capitec Pay refund does not need attention.');
  const restored = await refunds.restoreToWallet({ actorUserId: admin, refundId: capitecRefund.id, reason: 'Player prefers wallet credit' });
  assert(restored.status === 'RESTORED_TO_WALLET', 'A needs-attention refund could not be returned to the wallet.');
  fake.refundStatus = 'pending';

  // Chargebacks are handled by payment reference, whatever the method.
  const disputer = await createUser('b');
  const disputed = await topUp(disputer, 30_000, 'capitec_pay');
  const chargebacks = new PaymentDisputesService();
  await chargebacks.open(disputed.reference, { id: `${marker}-dispute`, refund_amount: 30_000, transaction: { reference: disputed.reference, amount: 30_000 } });
  assert((await prisma.providerDispute.count({ where: { providerPaymentId: disputed.id } })) === 1, 'A Capitec Pay chargeback was not recorded.');
  assert((await prisma.user.findUniqueOrThrow({ where: { id: disputer } })).bookingRestrictedAt, 'A Capitec Pay chargeback did not restrict bookings.');

  for (const userId of userIds) {
    const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { userId } });
    const ledger = await prisma.walletTransaction.aggregate({ where: { walletAccountId: wallet.id, status: 'SUCCEEDED' }, _sum: { amountCents: true } });
    assert((ledger._sum.amountCents ?? 0) === wallet.balanceCents, 'A wallet does not reconcile to its ledger.');
  }
  console.log('Payment methods smoke passed: checkout asks for exactly card, Apple Pay, Capitec Pay and Instant EFT; each is credited and QR is parked for review; a needs-attention bank refund is completed with the customer\'s account (never stored, audit keeps last 4) or returned to the wallet; a Capitec Pay chargeback restricts bookings; wallets reconcile.');
} finally {
  const payments = await prisma.providerPayment.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  for (const { id } of payments) await prisma.durableJob.deleteMany({ where: { dedupeKey: { startsWith: `paystack-topup-expire:${id}` } } });
  await prisma.providerDispute.deleteMany({ where: { providerPayment: { userId: { in: userIds } } } });
  await prisma.providerRefund.deleteMany({ where: { providerPayment: { userId: { in: userIds } } } });
  await prisma.providerPayment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: [...userIds, retainedAdmin].filter(Boolean) } } });
  await prisma.walletTransaction.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await fake.stop();
  await prisma.$disconnect();
}
