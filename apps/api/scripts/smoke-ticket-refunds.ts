import './assert-disposable-test-database.js';
import { removeTicketJobsSince } from './support/ticket-job-cleanup.js';
const smokeStartedAt = new Date();
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { AdminFinanceService } from '../src/modules/payments/admin-finance.service.js';
import { CardRefundsService } from '../src/modules/payments/card-refunds.service.js';
import { PaystackClient } from '../src/modules/payments/paystack.client.js';
import { requestTicketRefundInTx } from '../src/modules/tickets/ticket-refunds.js';
import { assert, socialWorld } from './social-fixtures.js';
import { FAKE_PAYSTACK_SECRET, FakePaystack } from './support/fake-paystack-server.js';

/**
 * DEC-021 A7 on PostgreSQL: ticket refunds go back to the original payment method through the Paystack Refund API,
 * partially (one ticket's price) when one payment covered several players, always to the payer. Every refund.*
 * webhook is idempotent; two equal refunds on one payment are never confused; a failed refund stays in the finance
 * queue and never becomes a credit or wallet money; a bank refund needing the customer's account goes through the
 * existing NEEDS_ATTENTION flow (details sent to Paystack, never stored).
 */
const world = socialWorld(`trf-${randomUUID().slice(0, 8)}`);
const fake = await new FakePaystack().start();
const refunds = new CardRefundsService(new PaystackClient({ secretKey: FAKE_PAYSTACK_SECRET, baseUrl: fake.baseUrl, channels: ['card'] }));
const finance = new AdminFinanceService();
const codeOf = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return 'OK';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
};
const created = { checkoutIds: [] as string[], paymentIds: [] as string[] };

try {
  const [payer, mate, admin] = [await world.player('Payer'), await world.player('Mate'), await world.player('Admin')];
  const match = await world.finishedMatch([payer.id], [mate.id], { startsAt: new Date(Date.now() + 3 * 86_400_000) });
  // One Paystack payment of R160 that covered two players' tickets (a team payment, A5).
  const payment = await prisma.providerPayment.create({
    data: { userId: payer.id, purpose: 'TICKETS', provider: 'paystack', reference: `ff_ticket_${randomUUID().replaceAll('-', '')}`, amountCents: 16_000, status: 'SUCCEEDED', verifiedAt: new Date(), creditedBy: 'webhook', channel: 'eft' },
  });
  created.paymentIds.push(payment.id);
  const checkout = await prisma.ticketCheckout.create({
    data: { matchId: match.id, payerId: payer.id, kind: 'TEAM', method: 'PAYMENT', providerPaymentId: payment.id, amountCents: 16_000, idempotencyKey: randomUUID(), policyAcceptedAt: new Date(), termsVersion: '2.4', policyText: 'smoke', status: 'COMPLETED', completedAt: new Date() },
  });
  created.checkoutIds.push(checkout.id);
  const ticket = (playerId: string) =>
    prisma.matchTicket.create({
      data: { matchId: match.id, checkoutId: checkout.id, playerId, payerId: payer.id, side: 'HOME', seat: 'SUBSTITUTE', method: 'PAYMENT', amountCents: 8_000, status: 'CLOSED', confirmedAt: new Date(), closedAt: new Date(), outcome: 'REFUNDED' },
    });
  const [t1, t2] = [await ticket(payer.id), await ticket(mate.id)];
  const [r1, r2] = await prisma.$transaction(async (tx) => [
    await requestTicketRefundInTx(tx, { ticketId: t1.id, source: 'TICKET_LEFT', reason: 'Left more than 24 hours before', initiatedByUserId: payer.id }),
    await requestTicketRefundInTx(tx, { ticketId: t2.id, source: 'MATCH_CANCELLED', reason: 'Match cancelled', initiatedByUserId: payer.id }),
  ]);
  const again = await prisma.$transaction((tx) => requestTicketRefundInTx(tx, { ticketId: t1.id, source: 'TICKET_LEFT', reason: 'again', initiatedByUserId: payer.id }));
  assert(again.id === r1.id, 'A second refund was created for the same ticket.');

  // 1. Partial refunds: each ticket's R80 goes to Paystack against the one payment, to the payer.
  fake.refundStatus = 'pending';
  await refunds.submitQueued(r1.id);
  await refunds.submitQueued(r2.id);
  await refunds.submitQueued(r1.id);
  assert(fake.refunds.length === 2 && fake.refunds.every((item) => item.amount === 8_000 && item.transaction === payment.reference), 'The partial refunds were not sent as two R80 refunds of the payment.');
  const [s1, s2] = await Promise.all([r1, r2].map(({ id }) => prisma.providerRefund.findUniqueOrThrow({ where: { id } })));
  assert(s1.providerRefundId && s2.providerRefundId && s1.providerRefundId !== s2.providerRefundId, 'Paystack refund ids were not stored.');

  // 2. Webhooks: two open R80 refunds and an event without an id are never guessed; with the id it is exact and idempotent.
  assert((await refunds.applyWebhook('refund.processed', payment.reference, { amount: 8_000, status: 'processed' })) === 'refund_ambiguous', 'An ambiguous refund event was applied to a guessed refund.');
  assert((await refunds.applyWebhook('refund.processed', payment.reference, { id: Number(s2.providerRefundId), amount: 8_000, status: 'processed' })) === 'refund_processed', 'The refund event with its id was not applied.');
  assert((await refunds.applyWebhook('refund.processed', payment.reference, { id: Number(s2.providerRefundId), amount: 8_000, status: 'processed' })) === 'refund_replayed', 'A repeated webhook was not idempotent.');
  assert((await prisma.providerRefund.findUniqueOrThrow({ where: { id: r1.id } })).status !== 'PROCESSED', 'The other ticket’s refund was marked processed.');

  // 3. A bank refund needing the customer's account (Instant EFT): NEEDS_ATTENTION, the payer is told, finance sends the details.
  assert((await refunds.applyWebhook('refund.pending', payment.reference, { id: Number(s1.providerRefundId), amount: 8_000, status: 'needs-attention' })) === 'refund_needs_attention', 'needs-attention was not recognised.');
  const notice = await prisma.notification.findFirst({ where: { userId: payer.id, type: 'TICKET_REFUND_UPDATE' } });
  assert(notice?.title === 'Refund needs your bank details', 'The payer was not told the refund needs bank details.');
  const queue = await finance.refundsNeedingAttention();
  const listed = queue.find(({ id }) => id === payment.id);
  assert(listed?.purpose === 'TICKETS' && listed.refunds.some((item) => item.ticketId === t1.id && item.matchId === match.id), 'The ticket refund is not in the finance queue as a ticket refund.');
  assert(!('restoreToWallet' in refunds), 'A refund can still be returned to a wallet.');
  await refunds.retryWithCustomerDetails({ actorUserId: admin.id, refundId: r1.id, accountNumber: '1234567890', bankId: '140', bankName: 'Capitec Bank' });
  const retried = await prisma.providerRefund.findUniqueOrThrow({ where: { id: r1.id } });
  assert(retried.status === 'PROCESSING' && !JSON.stringify(retried).includes('1234567890'), 'The bank-details retry failed or stored the account number.');
  const audit = await prisma.adminAuditLog.findFirst({ where: { entityId: r1.id, action: 'TOP_UP_REFUND_BANK_DETAILS_SENT' } });
  assert((audit?.metadata as { accountLast4?: string } | null)?.accountLast4 === '7890', 'The audit does not keep only the last 4 digits.');

  // 4. A failed refund stays FAILED for finance (never a credit), and can be retried.
  assert((await refunds.applyWebhook('refund.failed', payment.reference, { id: Number(s1.providerRefundId), amount: 8_000, status: 'failed' })) === 'refund_failed', 'refund.failed was not applied.');
  assert(!(await prisma.matchCredit.count({ where: { userId: payer.id } })), 'A failed refund turned into a credit.');
  await refunds.retry({ actorUserId: admin.id, refundId: r1.id });
  assert((fake.refunds.length as number) === 3, 'A retried refund was not sent again.');

  // 5. A ticket payment is never refunded free-form by an admin: refunds come from the ticket rules only.
  assert(!('initiate' in refunds), 'A free-form refund can still be started.');
  console.log('Ticket refunds smoke passed: once per ticket, partial R80 refunds of one shared payment to the payer, ambiguous events never guessed, events with ids exact and idempotent, needs-attention bank refunds completed with details never stored (audit keeps last 4), failed refunds stay for finance and are retried (never a credit or wallet money), and ticket payments are only refunded by the ticket rules.');
} finally {
  await removeTicketJobsSince(smokeStartedAt);
  await prisma.notification.deleteMany({ where: { userId: { in: world.userIds } } });
  await prisma.providerRefund.deleteMany({ where: { providerPaymentId: { in: created.paymentIds } } });
  await prisma.matchTicket.deleteMany({ where: { checkoutId: { in: created.checkoutIds } } });
  await prisma.ticketCheckout.deleteMany({ where: { id: { in: created.checkoutIds } } });
  await prisma.providerPayment.deleteMany({ where: { id: { in: created.paymentIds } } });
  await prisma.matchLineupEntry.deleteMany({ where: { matchId: { in: world.matchIds } } });
  // The admin is named in the append-only audit log, so the users stay (marked) in the disposable database.
  await prisma.match.deleteMany({ where: { id: { in: world.matchIds } } });
  await fake.stop();
  await prisma.$disconnect();
}
