import './assert-disposable-test-database.js';
import { removeTicketJobsSince } from './support/ticket-job-cleanup.js';
const smokeStartedAt = new Date();
import { randomUUID } from 'node:crypto';
import { ticketCancellationPolicy } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { DISPUTE_LOST_REASON, DISPUTE_OPEN_REASON, PaymentDisputesService } from '../src/modules/payments/payment-disputes.service.js';
import { PaystackWebhookProcessor } from '../src/modules/payments/paystack-webhook.jobs.js';
import { assert, socialWorld } from './social-fixtures.js';

/**
 * DEC-021 A8 / D9 on PostgreSQL: payment disputes (chargebacks) on ticket payments.
 * - charge.dispute.create records the dispute once (replays are no-ops) and restricts only the payer from buying
 *   tickets or using credits. The tickets in that payment stay valid; no wallet or ledger money moves.
 * - The evidence pack holds the tickets and match, the accepted policy (time, Terms version, wording, IP address,
 *   browser), the emails sent, and whether each player played (the referee's lineup record).
 * - Won: the restriction lifts by itself. Lost: it stays (even if a later dispute is won) until an admin lifts it
 *   with a reason; an admin can't lift it while a dispute is still open. Every lift is audited.
 */
const world = socialWorld(`tdp-${randomUUID().slice(0, 8)}`);
const disputes = new PaymentDisputesService();
const processor = new PaystackWebhookProcessor();
const codeOf = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return 'OK';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
};
const created = { checkoutIds: [] as string[], paymentIds: [] as string[], eventIds: [] as string[] };
/** Delivers a signed-and-stored Paystack event through the real webhook processor. */
const deliver = async (eventType: string, reference: string, data: Record<string, unknown>) => {
  const event = await prisma.paymentWebhookEvent.create({
    data: { provider: 'paystack', dedupeKey: `smoke:${randomUUID()}`, eventType, reference, signatureValid: true, payload: JSON.parse(JSON.stringify({ event: eventType, data })) },
  });
  created.eventIds.push(event.id);
  await processor.process(event.id);
  return (await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: event.id } })).outcome;
};

try {
  const [payer, mate, admin] = [await world.player('Payer'), await world.player('Mate'), await world.player('Admin')];
  // The match was played; the referee's lineup record shows the payer played and the teammate did not turn up.
  const match = await world.finishedMatch([payer.id], [mate.id], { didNotPlay: [mate.id] });
  const paidTickets = async (amountCents: number, players: string[], onMatch = match) => {
    const payment = await prisma.providerPayment.create({
      data: { userId: payer.id, purpose: 'TICKETS', provider: 'paystack', reference: `ff_ticket_${randomUUID().replaceAll('-', '')}`, amountCents, status: 'SUCCEEDED', verifiedAt: new Date(), creditedBy: 'webhook', channel: 'card' },
    });
    created.paymentIds.push(payment.id);
    const checkout = await prisma.ticketCheckout.create({
      data: {
        matchId: onMatch.id, payerId: payer.id, kind: 'TEAM', method: 'PAYMENT', providerPaymentId: payment.id, amountCents, idempotencyKey: randomUUID(),
        policyAcceptedAt: new Date(), termsVersion: '2.4', policyText: ticketCancellationPolicy().join('\n'), ipAddress: '196.25.1.10', userAgent: 'Mozilla/5.0 (smoke)', status: 'COMPLETED', completedAt: new Date(),
      },
    });
    created.checkoutIds.push(checkout.id);
    const tickets = [];
    for (const playerId of players)
      tickets.push(await prisma.matchTicket.create({
        data: { matchId: onMatch.id, checkoutId: checkout.id, playerId, payerId: payer.id, side: playerId === payer.id ? 'HOME' : 'AWAY', seat: 'SUBSTITUTE', method: 'PAYMENT', amountCents: 8_000, status: 'CONFIRMED', confirmedAt: new Date() },
      }));
    await prisma.ticketEmail.create({ data: { userId: payer.id, kind: 'RECEIPT', subject: 'Your FootyFinder match ticket', matchId: onMatch.id, checkoutId: checkout.id } });
    return { payment, checkout, tickets };
  };
  const first = await paidTickets(16_000, [payer.id, mate.id]);
  const restriction = async (userId: string) => prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { bookingRestrictedAt: true, bookingRestrictionReason: true } });

  // 1. A dispute is recorded once; only the payer is restricted; their tickets stay valid; no wallet money moves.
  const disputeData = { id: 990_001, refund_amount: 16_000, due_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), transaction: { reference: first.payment.reference, amount: 16_000 } };
  assert((await deliver('charge.dispute.create', first.payment.reference, disputeData)) === 'dispute_opened', 'The dispute was not opened through the webhook.');
  assert((await deliver('charge.dispute.create', first.payment.reference, disputeData)) === 'dispute_replayed', 'A replayed dispute was not a no-op.');
  assert((await prisma.providerDispute.count({ where: { providerPaymentId: first.payment.id } })) === 1, 'The dispute was recorded twice.');
  const restricted = await restriction(payer.id);
  assert(restricted.bookingRestrictedAt && restricted.bookingRestrictionReason === DISPUTE_OPEN_REASON, 'The payer was not restricted.');
  assert(!(await restriction(mate.id)).bookingRestrictedAt, 'A teammate who did not dispute was restricted.');
  assert((await prisma.matchTicket.count({ where: { checkoutId: first.checkout.id, status: 'CONFIRMED' } })) === 2, 'Disputing cancelled the tickets.');
  assert(!(await prisma.walletTransaction.count({ where: { walletAccount: { userId: payer.id } } })), 'A dispute moved wallet money.');
  assert((await prisma.notification.count({ where: { userId: payer.id, type: 'PAYMENT_DISPUTE_OPENED' } })) === 1, 'The payer was not told exactly once.');

  // 2. The evidence pack.
  const [listed] = (await disputes.list()).filter(({ reference }) => reference === first.payment.reference);
  assert(listed?.status === 'OPEN' && listed.ticketCount === 2 && listed.dueAt && listed.payer.bookingRestrictionReason === DISPUTE_OPEN_REASON, 'The dispute is not listed correctly.');
  const pack = await disputes.evidence(listed.id);
  assert(pack.policyAcceptance?.ipAddress === '196.25.1.10' && pack.policyAcceptance.userAgent === 'Mozilla/5.0 (smoke)' && pack.policyAcceptance.termsVersion === '2.4', 'The policy acceptance is missing from the evidence.');
  assert(pack.policyAcceptance.policyText.includes('match credit'), 'The policy wording shown is missing from the evidence.');
  assert(pack.payer.email === payer.email && pack.payment.reference === first.payment.reference && pack.payment.channel === 'card', 'The payment or payer is missing from the evidence.');
  const attendance = Object.fromEntries(pack.tickets.map((ticket) => [ticket.id, ticket.attendance]));
  assert(attendance[first.tickets[0]!.id] === 'PLAYED' && attendance[first.tickets[1]!.id] === 'DID_NOT_PLAY', `Attendance is wrong: ${JSON.stringify(attendance)}`);
  assert(pack.tickets.every((ticket) => ticket.match.id === match.id && ticket.match.venueName.includes('venue')), 'The match is missing from the evidence.');
  assert(pack.emails.some((email) => email.kind === 'RECEIPT'), 'The receipt email is missing from the evidence.');
  assert(!JSON.stringify(pack).toLowerCase().includes('wallet'), 'The evidence pack mentions a wallet.');

  // 3. An admin can't lift the restriction while the dispute is open; won lifts it by itself, once.
  assert((await codeOf(() => disputes.liftRestriction({ actorUserId: admin.id, userId: payer.id, reason: 'early' }))) === 'PAYMENT_DISPUTE_OPEN', 'An admin lifted a restriction while the dispute was open.');
  assert((await deliver('charge.dispute.resolve', first.payment.reference, { id: 990_001, resolution: 'declined' })) === 'dispute_won', 'The won resolution was not applied.');
  assert((await deliver('charge.dispute.resolve', first.payment.reference, { id: 990_001, resolution: 'declined' })) === 'dispute_replayed', 'A replayed resolution was not a no-op.');
  assert(!(await restriction(payer.id)).bookingRestrictedAt, 'A won dispute did not lift the restriction.');

  // 4. Lost: the restriction stays, even after a later dispute is won, until an admin lifts it (reason, audited).
  const second = await paidTickets(8_000, [payer.id], await world.finishedMatch([payer.id], []));
  const third = await paidTickets(8_000, [payer.id], await world.finishedMatch([payer.id], []));
  await disputes.open(second.payment.reference, { id: 990_002, transaction: { reference: second.payment.reference, amount: 8_000 } });
  assert((await disputes.resolve({ id: 990_002, resolution: 'merchant-accepted' })) === 'dispute_lost', 'The lost resolution was not applied.');
  assert((await restriction(payer.id)).bookingRestrictionReason === DISPUTE_LOST_REASON, 'A lost dispute did not keep the restriction.');
  await disputes.open(third.payment.reference, { id: 990_003, transaction: { reference: third.payment.reference, amount: 8_000 } });
  await disputes.resolve({ id: 990_003, resolution: 'declined' });
  const stillLost = await restriction(payer.id);
  assert(stillLost.bookingRestrictedAt && stillLost.bookingRestrictionReason === DISPUTE_LOST_REASON, 'A later won dispute lifted a lost-dispute restriction.');
  assert((await codeOf(() => disputes.liftRestriction({ actorUserId: admin.id, userId: payer.id, reason: '  ' }))) === 'REASON_REQUIRED', 'A restriction was lifted without a reason.');
  assert((await disputes.liftRestriction({ actorUserId: admin.id, userId: payer.id, reason: 'Repaid by EFT; confirmed with finance' })).changed, 'The admin could not lift the restriction.');
  assert(!(await restriction(payer.id)).bookingRestrictedAt, 'The restriction is still there.');
  assert((await prisma.adminAuditLog.count({ where: { entityId: payer.id, action: 'BOOKING_RESTRICTION_LIFTED' } })) === 1, 'The lift was not audited.');
  assert(!(await disputes.liftRestriction({ actorUserId: admin.id, userId: payer.id, reason: 'again' })).changed, 'Lifting twice changed something.');
  console.log('Ticket disputes smoke passed: a dispute is recorded once and restricts only the payer (tickets stay valid, no wallet money moves); the evidence pack holds the tickets, match, accepted policy with IP and browser, emails and attendance; won lifts the restriction by itself; lost keeps it, even past a later won dispute, until an admin lifts it with a reason (audited, never while a dispute is open).');
} finally {
  await removeTicketJobsSince(smokeStartedAt);
  await prisma.providerDispute.deleteMany({ where: { providerPaymentId: { in: created.paymentIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: world.userIds } } });
  await prisma.ticketEmail.deleteMany({ where: { checkoutId: { in: created.checkoutIds } } });
  await prisma.matchTicket.deleteMany({ where: { checkoutId: { in: created.checkoutIds } } });
  await prisma.ticketCheckout.deleteMany({ where: { id: { in: created.checkoutIds } } });
  await prisma.providerPayment.deleteMany({ where: { id: { in: created.paymentIds } } });
  await prisma.paymentWebhookEvent.deleteMany({ where: { id: { in: created.eventIds } } });
  await prisma.matchLineupEntry.deleteMany({ where: { matchId: { in: world.matchIds } } });
  await prisma.user.updateMany({ where: { id: { in: world.userIds } }, data: { bookingRestrictedAt: null, bookingRestrictionReason: null } });
  // The admin and payer are named in the append-only audit log, so the users stay (marked) in the disposable database.
  await prisma.match.deleteMany({ where: { id: { in: world.matchIds } } });
  await prisma.$disconnect();
}
