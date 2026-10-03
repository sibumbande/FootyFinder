import './assert-disposable-test-database.js';
import { removeTicketJobsSince } from './support/ticket-job-cleanup.js';
const smokeStartedAt = new Date();
import { randomUUID } from 'node:crypto';
import { getMaxParticipantsPerTeam } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { PaystackClient } from '../src/modules/payments/paystack.client.js';
import { expireTicketHold, TicketCheckoutService } from '../src/modules/tickets/ticket-checkout.service.js';
import { TestEmailProvider } from '../src/modules/auth/email.provider.js';
import { CardRefundsService } from '../src/modules/payments/card-refunds.service.js';
import { PaystackWebhookProcessor } from '../src/modules/payments/paystack-webhook.jobs.js';
import { sendTicketEmail } from '../src/modules/tickets/ticket-emails.js';
import { runTicketHoldExpiry } from '../src/modules/tickets/ticket.jobs.js';
import { TicketSettlementService } from '../src/modules/tickets/ticket-settlement.service.js';
import { managedVenueFixture } from './managed-venue-fixture.js';
import { FAKE_PAYSTACK_SECRET, FakePaystack } from './support/fake-paystack-server.js';

/**
 * DEC-021 A1 on PostgreSQL: buying a ticket. A paid place is held for 10 minutes while the player pays on Paystack
 * ("Being booked" to everyone else; nobody can buy or claim it), the player is placed only once the payment is
 * confirmed, a double tap is one checkout, two buyers racing for one position get one hold, an unpaid hold is
 * released by the durable job, a free match gives an R0 ticket with the promotions ledger unchanged, and the
 * lineup lock, a full side and a payment dispute all refuse a purchase.
 */
const marker = `tickets-${randomUUID().slice(0, 8)}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const codeOf = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return 'OK';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
};
const venue = managedVenueFixture(marker);
const bookings = new BookingsService();
const matches = new MatchesService();
const fake = await new FakePaystack().start();
const termsVersion = async () => '2.4';
const gateway = new PaystackClient({ secretKey: FAKE_PAYSTACK_SECRET, baseUrl: fake.baseUrl, channels: ['card'] });
const settlement = new TicketSettlementService(gateway, undefined, ['card']);
const paystack = new TicketCheckoutService(gateway, undefined, settlement, {
  clientUrl: 'http://localhost:5173', demo: () => false, paystackEnabled: () => true, termsVersion,
});
const processor = new PaystackWebhookProcessor(undefined, undefined, undefined, settlement);
const refunds = new CardRefundsService(gateway);
const emails = new TestEmailProvider();
const webhookIds: string[] = [];
/** A verified (signed) charge.success webhook, as the webhook route stores it. */
const webhook = async (reference: string) => {
  const event = await prisma.paymentWebhookEvent.create({
    data: { provider: 'paystack', dedupeKey: `smoke:${randomUUID()}`, eventType: 'charge.success', reference, signatureValid: true, payload: { event: 'charge.success', data: { reference } } },
  });
  webhookIds.push(event.id);
  return processor.process(event.id);
};
const demo = new TicketCheckoutService(undefined, undefined, undefined, { clientUrl: 'http://localhost:5173', demo: () => true, paystackEnabled: () => false, termsVersion });
const matchIds: string[] = [];
const userIds: string[] = [];

const player = async (label: string) => {
  const user = await prisma.user.create({
    data: {
      email: `${marker}-${label}@smoke.invalid`,
      username: `tk_${randomUUID().slice(0, 12)}`,
      passwordHash: 'smoke-test-only',
      emailVerifiedAt: new Date(),
      onboardingCompletedAt: new Date(),
      profile: { create: { displayName: `${label} ${marker.slice(-4)}`, onboardingStatus: 'COMPLETE', gender: 'MALE' } },
    },
  });
  userIds.push(user.id);
  return user.id;
};
const quickMatch = async (hostId: string, substituteCapacityPerTeam = 2) => {
  const match = await bookings.createQuickMatch(
    { managedFieldId: venue.fieldId, name: `${marker}-${matchIds.length}`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: venue.nextKickoff().toISOString() },
    hostId,
  );
  matchIds.push(match.id);
  return match;
};
const homeSlots = async (matchId: string) =>
  prisma.formationSlot.findMany({ where: { matchId, team: 'HOME' }, orderBy: { slotIndex: 'asc' } });
const position = (slotId: string) => ({ seat: 'POSITION' as const, side: 'HOME' as const, slotId, method: 'PAYMENT' as const, acceptPolicy: true as const });
const sub = (side: 'HOME' | 'AWAY' = 'HOME') => ({ seat: 'SUBSTITUTE' as const, side, method: 'PAYMENT' as const, acceptPolicy: true as const });

try {
  await venue.create();
  const [host, a, b, c, d, e] = [await player('host'), await player('a'), await player('b'), await player('c'), await player('d'), await player('e')];
  const match = await quickMatch(host);
  const [slot1, slot2, slot3] = await homeSlots(match.id);

  // 1. A pays by card: the position is held (Being booked) and nothing is placed yet. A double tap is one checkout.
  const key = randomUUID();
  const started = await paystack.start(match.id, a, position(slot1!.id), key, { ip: '198.51.100.7', userAgent: 'smoke-browser' });
  assert(started.state === 'PROCESSING' && started.authorizationUrl?.startsWith('https://checkout.paystack.com/'), 'A paid checkout did not go to Paystack.');
  const again = await paystack.start(match.id, a, position(slot1!.id), key);
  assert(again.checkoutId === started.checkoutId && fake.calls.initialize === 1, 'A double tap started two checkouts.');
  const checkout = await prisma.ticketCheckout.findUniqueOrThrow({ where: { id: started.checkoutId }, include: { providerPayment: true, tickets: true } });
  assert(checkout.policyText.includes('24 hours') && checkout.termsVersion === '2.4' && checkout.ipAddress === '198.51.100.7' && checkout.userAgent === 'smoke-browser', 'The policy acceptance was not recorded.');
  assert(checkout.providerPayment?.purpose === 'TICKETS' && checkout.providerPayment.walletTransactionId === null && checkout.providerPayment.reference.startsWith('ff_ticket_'), 'The ticket payment looks like a top-up.');
  assert(checkout.tickets[0]?.status === 'HELD' && !(await prisma.matchParticipant.findFirst({ where: { matchId: match.id, userId: a } })), 'A was placed before paying.');
  const lobby = await matches.get(match.id, b);
  assert(lobby.bookingHolds?.slotIds.includes(slot1!.id), 'The lobby does not show the position as Being booked.');
  assert(!JSON.stringify(lobby.bookingHolds).includes(a), 'The lobby reveals who is paying.');

  // 2. Nobody else can buy or claim a position being booked; A can't hold two places.
  assert((await codeOf(() => paystack.start(match.id, b, position(slot1!.id), randomUUID()))) === 'POSITION_BEING_BOOKED', 'B could buy a position being booked.');
  assert((await codeOf(() => paystack.start(match.id, a, position(slot2!.id), randomUUID()))) === 'ALREADY_IN_MATCH', 'A could hold two places.');
  const cJoined = await demo.start(match.id, c, sub(), randomUUID());
  assert(cJoined.state === 'CONFIRMED', 'The demo operator did not confirm instantly.');
  assert((await codeOf(() => matches.claimPosition(match.id, slot1!.id, c))) === 'POSITION_BEING_BOOKED', 'A joined player could claim a position being booked.');

  // 3. Two players racing for one open position: exactly one hold.
  const race = await Promise.all([b, d].map((userId) => codeOf(() => paystack.start(match.id, userId, position(slot2!.id), randomUUID()))));
  assert(race.filter((code) => code === 'OK').length === 1 && race.includes('POSITION_BEING_BOOKED'), `The race for one position gave ${race.join(', ')}.`);
  assert((await prisma.matchTicket.count({ where: { slotId: slot2!.id, status: 'HELD' } })) === 1, 'Two holds exist for one position.');

  // 4. Ten minutes later, unpaid: the job releases the hold (twice is safe) and the position is free again.
  const later = new Date(Date.now() + 11 * 60_000);
  assert((await codeOf(() => expireTicketHold(started.checkoutId))) === 'TICKET_HOLD_NOT_DUE', 'The hold was released early.');
  await expireTicketHold(started.checkoutId, later);
  await expireTicketHold(started.checkoutId, later);
  const expired = await prisma.ticketCheckout.findUniqueOrThrow({ where: { id: started.checkoutId }, include: { tickets: true } });
  assert(expired.status === 'EXPIRED' && expired.tickets[0]?.status === 'RELEASED', 'The unpaid hold was not released.');
  assert((await paystack.status(a, started.checkoutId)).state === 'EXPIRED', 'The return page does not show the expired checkout.');
  const eHolds = await paystack.start(match.id, e, position(slot1!.id), randomUUID());
  assert(eHolds.state === 'PROCESSING', 'A released position could not be bought again.');

  // 5. The demo operator: a confirmed ticket places the player in the position (formation event, verified payment).
  const dPlace = await demo.start(match.id, d, position(slot3!.id), randomUUID());
  const dTicket = await prisma.matchTicket.findUniqueOrThrow({ where: { id: dPlace.ticketIds[0] }, include: { checkout: { include: { providerPayment: true } } } });
  assert(dTicket.status === 'CONFIRMED' && dTicket.participantId && dTicket.checkout.status === 'COMPLETED', 'The confirmed ticket was not placed.');
  assert(dTicket.checkout.providerPayment?.status === 'SUCCEEDED' && dTicket.checkout.providerPayment.creditedBy === 'demo', 'The demo payment was not recorded as verified.');
  assert((await prisma.formationSlot.findUniqueOrThrow({ where: { id: slot3!.id } })).participantId === dTicket.participantId, 'The player is not in the position they paid for.');
  const context = await demo.context(match.id, d);
  assert(context.ticket?.status === 'CONFIRMED' && context.leave.allowed && context.leave.outcome === 'CHOICE' && context.policy.length === 4, 'The ticket context is wrong.');

  // 6. A free match: an R0 ticket, no payment, FootyFinder's promotions ledger as before.
  const free = await quickMatch(host);
  await prisma.match.update({ where: { id: free.id }, data: { freeOnFootyFinder: true, feeCents: 0 } });
  const freeTicket = await paystack.start(free.id, a, sub(), randomUUID());
  const freeRow = await prisma.matchTicket.findUniqueOrThrow({ where: { id: freeTicket.ticketIds[0] }, include: { checkout: true } });
  assert(freeTicket.state === 'CONFIRMED' && freeRow.method === 'FREE' && freeRow.amountCents === 0 && !freeRow.checkout.providerPaymentId, 'A free place was not an R0 ticket.');
  assert((await prisma.promotionalCost.count({ where: { matchId: free.id, userId: a, status: 'ACTIVE' } })) === 1, 'The free place is missing from the promotions ledger.');

  // 7. Refusals: a full side, the lineup lock and a disputed payment.
  const tight = await quickMatch(host, 0);
  const max = getMaxParticipantsPerTeam('FIVE_A_SIDE', 0);
  const fillers = await Promise.all(Array.from({ length: max }, (_, index) => player(`f${index}`)));
  for (const userId of fillers) await demo.start(tight.id, userId, sub(), randomUUID());
  assert((await codeOf(() => demo.start(tight.id, b, sub(), randomUUID()))) === 'SIDE_FULL', 'A full side sold another ticket.');
  await prisma.match.update({ where: { id: free.id }, data: { goNoGoAt: new Date(Date.now() - 60_000) } });
  assert((await codeOf(() => paystack.start(free.id, b, sub(), randomUUID()))) === 'LINEUP_LOCKED', 'A ticket was sold after the lineup lock.');
  await prisma.user.update({ where: { id: b }, data: { bookingRestrictedAt: new Date(), bookingRestrictionReason: 'smoke dispute' } });
  assert((await codeOf(() => paystack.start(match.id, b, sub('AWAY'), randomUUID()))) === 'BOOKING_RESTRICTED', 'A player with a disputed payment could buy a ticket.');
  // 8. Paystack confirms: whichever of the webhook, the status check and the hold-expiry job comes first, the player
  //    is placed exactly once and gets one receipt. A late payment is placed if the position is still free.
  const paid = await quickMatch(host);
  const [p1, p2, p3, p4, p5] = await homeSlots(paid.id);
  const [x1, x2, x3, x4, x5] = [await player('x1'), await player('x2'), await player('x3'), await player('x4'), await player('x5')];
  const placedOnce = async (checkoutId: string, playerId: string) => {
    const tickets = await prisma.matchTicket.findMany({ where: { checkoutId } });
    assert(tickets.length === 1 && tickets[0]!.status === 'CONFIRMED', 'The paid ticket was not confirmed.');
    assert((await prisma.matchParticipant.count({ where: { matchId: paid.id, userId: playerId, status: 'JOINED' } })) === 1, 'The player was not placed exactly once.');
    assert((await prisma.durableJob.count({ where: { dedupeKey: { startsWith: `ticket-email:RECEIPT:${checkoutId}` } } })) === 1, 'The receipt was not queued exactly once.');
  };
  const webhookFirst = await paystack.start(paid.id, x1, position(p1!.id), randomUUID());
  fake.pay(webhookFirst.reference!);
  await webhook(webhookFirst.reference!);
  assert((await paystack.status(x1, webhookFirst.checkoutId)).state === 'CONFIRMED', 'The webhook did not confirm the ticket.');
  await runTicketHoldExpiry(webhookFirst.checkoutId, settlement, new Date(Date.now() + 11 * 60_000));
  await placedOnce(webhookFirst.checkoutId, x1);

  const verifyFirst = await paystack.start(paid.id, x2, position(p2!.id), randomUUID());
  fake.pay(verifyFirst.reference!);
  assert((await paystack.statusByReference(x2, verifyFirst.reference!)).state === 'CONFIRMED', 'The status check did not confirm the paid ticket.');
  await webhook(verifyFirst.reference!);
  await placedOnce(verifyFirst.checkoutId, x2);

  const allAtOnce = await paystack.start(paid.id, x3, position(p3!.id), randomUUID());
  fake.pay(allAtOnce.reference!);
  await Promise.all([
    webhook(allAtOnce.reference!).catch(() => undefined),
    settlement.settleFromVerify(allAtOnce.reference!, 'expiry_job').catch(() => undefined),
    paystack.statusByReference(x3, allAtOnce.reference!),
  ]);
  await placedOnce(allAtOnce.checkoutId, x3);

  // Late, position still free: placed.
  const late = await paystack.start(paid.id, x4, position(p4!.id), randomUUID());
  await expireTicketHold(late.checkoutId, new Date(Date.now() + 11 * 60_000));
  fake.pay(late.reference!);
  await webhook(late.reference!);
  assert((await paystack.status(x4, late.checkoutId)).state === 'CONFIRMED', 'A late payment for a still-free position was not placed.');

  // 9. Late, the position is gone: refunded in full to the original method (never a credit), with an email.
  const gone = await paystack.start(paid.id, x5, position(p5!.id), randomUUID());
  await expireTicketHold(gone.checkoutId, new Date(Date.now() + 11 * 60_000));
  await demo.start(paid.id, e, position(p5!.id), randomUUID());
  fake.pay(gone.reference!);
  await webhook(gone.reference!);
  const goneTicket = await prisma.matchTicket.findFirstOrThrow({ where: { checkoutId: gone.checkoutId }, include: { refunds: true } });
  assert(goneTicket.status === 'CLOSED' && goneTicket.outcome === 'LATE_PAYMENT_REFUNDED' && goneTicket.refunds.length === 1, 'A late payment for a taken position was not refunded.');
  assert(goneTicket.refunds[0]!.amountCents === 8_000 && goneTicket.refunds[0]!.source === 'LATE_PAYMENT', 'The late refund is not the full ticket price.');
  assert(!(await prisma.matchCredit.count({ where: { userId: x5 } })), 'A late payment was turned into a credit.');
  assert(!(await prisma.matchParticipant.count({ where: { matchId: paid.id, userId: x5, status: 'JOINED' } })), 'The late payer was placed anyway.');
  const goneStatus = await paystack.status(x5, gone.checkoutId);
  assert(goneStatus.state === 'FAILED' && Boolean(goneStatus.refundReason?.includes('Someone else took that position')), 'The return page does not explain the refund.');
  await refunds.submitQueued(goneTicket.refunds[0]!.id);
  await refunds.submitQueued(goneTicket.refunds[0]!.id);
  assert(fake.calls.refund === 1, 'The late refund was not sent to Paystack exactly once.');
  await sendTicketEmail({ kind: 'LATE_PAYMENT_REFUND', userId: x5, checkoutId: gone.checkoutId }, emails);
  await sendTicketEmail({ kind: 'RECEIPT', userId: x1, checkoutId: webhookFirst.checkoutId }, emails);
  const receipt = emails.messages.find(({ subject }) => subject.startsWith('Your FootyFinder match ticket'));
  assert(receipt?.text.includes('Cancellation policy') && receipt.text.includes('Manage my ticket') && receipt.text.includes('Position'), 'The receipt is missing the place, the policy or the manage link.');
  assert(emails.messages.some(({ subject, text }) => subject.includes('refunded') && text.includes('Someone else took that position')), 'The late-refund email does not say why.');
  assert((await prisma.ticketEmail.count({ where: { userId: { in: [x1, x5] } } })) === 2, 'Sent ticket emails were not logged for dispute evidence.');

  // 10. An abandoned checkout fails cleanly and frees the place.
  await prisma.user.update({ where: { id: b }, data: { bookingRestrictedAt: null } });
  const quit = await paystack.start(paid.id, b, sub('AWAY'), randomUUID());
  fake.pay(quit.reference!, { status: 'abandoned' });
  await settlement.settleFromVerify(quit.reference!, 'expiry_job', { finalAttempt: true });
  const quitRow = await prisma.ticketCheckout.findUniqueOrThrow({ where: { id: quit.checkoutId }, include: { tickets: true } });
  assert(quitRow.status === 'FAILED' && quitRow.tickets[0]?.status === 'RELEASED', 'An abandoned checkout did not release the place.');

  console.log('Tickets smoke passed: a paid place is held for 10 minutes (Being booked, nobody else can buy or claim it, the lobby never says who), placed only once paid, one checkout per double tap, one hold per raced position, released by the job when unpaid (safe twice, never early), the policy acceptance is recorded with Terms version, IP and browser, the payment is a ticket payment (no wallet), free matches give R0 tickets with the promotions ledger unchanged, full sides, the lineup lock and payment disputes refuse a purchase, the webhook, status check and expiry job place a paid player exactly once in any order (one receipt), a late payment is placed if the position is still free and otherwise refunded in full to the original method (never a credit, sent to Paystack once, with an email saying why), sent emails are logged, and an abandoned checkout releases the place.');
} finally {
  await removeTicketJobsSince(smokeStartedAt);
  const checkoutIds = (await prisma.ticketCheckout.findMany({ where: { matchId: { in: matchIds } }, select: { id: true, providerPaymentId: true } }));
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.paymentWebhookEvent.deleteMany({ where: { id: { in: webhookIds } } });
  await prisma.ticketEmail.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.providerRefund.deleteMany({ where: { ticket: { matchId: { in: matchIds } } } });
  await prisma.matchTicket.deleteMany({ where: { matchId: { in: matchIds } } });
  await prisma.ticketCheckout.deleteMany({ where: { matchId: { in: matchIds } } });
  await prisma.providerPayment.deleteMany({ where: { id: { in: checkoutIds.flatMap(({ providerPaymentId }) => (providerPaymentId ? [providerPaymentId] : [])) } } });
  await venue.cleanupMatches(matchIds);
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  await venue.cleanupVenue();
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await fake.stop();
  await prisma.$disconnect();
}
