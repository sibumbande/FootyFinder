import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { getMaxParticipantsPerTeam } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { PaystackClient } from '../src/modules/payments/paystack.client.js';
import { expireTicketHold, TicketCheckoutService } from '../src/modules/tickets/ticket-checkout.service.js';
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
const paystack = new TicketCheckoutService(new PaystackClient({ secretKey: FAKE_PAYSTACK_SECRET, baseUrl: fake.baseUrl, channels: ['card'] }), undefined, {
  clientUrl: 'http://localhost:5173', demo: () => false, paystackEnabled: () => true, termsVersion,
});
const demo = new TicketCheckoutService(undefined, undefined, { clientUrl: 'http://localhost:5173', demo: () => true, paystackEnabled: () => false, termsVersion });
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
  console.log('Tickets smoke passed: a paid place is held for 10 minutes (Being booked, nobody else can buy or claim it, the lobby never says who), placed only once paid, one checkout per double tap, one hold per raced position, released by the job when unpaid (safe twice, never early), the policy acceptance is recorded with Terms version, IP and browser, the payment is a ticket payment (no wallet), free matches give R0 tickets with the promotions ledger unchanged, and full sides, the lineup lock and payment disputes refuse a purchase.');
} finally {
  const checkoutIds = (await prisma.ticketCheckout.findMany({ where: { matchId: { in: matchIds } }, select: { id: true, providerPaymentId: true } }));
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
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
