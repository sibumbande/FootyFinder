import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { MATCH_CREDIT_VALID_YEARS } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { serializableTransaction } from '../src/database/transaction.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { MatchesRepository } from '../src/modules/matches/matches.repository.js';
import { TicketCheckoutService } from '../src/modules/tickets/ticket-checkout.service.js';
import { TicketLeaveService } from '../src/modules/tickets/ticket-leave.service.js';
import { managedVenueFixture } from './managed-venue-fixture.js';

/**
 * DEC-021 A2/A3 on PostgreSQL. Leaving more than 24 hours before kick-off: choose 1 match credit or a refund to the
 * original payment method (a choice is required); 24 hours or less: nothing back, the place is released; from the
 * T-30 lock nobody can leave. A cancelled match gives every payer the credit-or-refund choice (one alert each,
 * refunded automatically after 7 days, exactly once), late leavers too (CEO D4); credit-paid tickets get their
 * credit back and free places owe nothing. Leaving and rejoining works. The old 12-hour and replacement rules are
 * not used for tickets.
 */
const marker = `tleave-${randomUUID().slice(0, 8)}`;
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
const repository = new MatchesRepository();
const buy = new TicketCheckoutService(undefined, undefined, undefined, { clientUrl: 'http://localhost:5173', demo: () => true, paystackEnabled: () => false, termsVersion: async () => '2.4' });
const leaving = new TicketLeaveService();
const matchIds: string[] = [];
const userIds: string[] = [];
const player = async (label: string) => {
  const user = await prisma.user.create({
    data: { email: `${marker}-${label}@smoke.invalid`, username: `tl_${randomUUID().slice(0, 12)}`, passwordHash: 'smoke-test-only', emailVerifiedAt: new Date(), onboardingCompletedAt: new Date(), profile: { create: { displayName: `${label} ${marker.slice(-4)}`, onboardingStatus: 'COMPLETE', gender: 'MALE' } } },
  });
  userIds.push(user.id);
  return user.id;
};
const quickMatch = async (hostId: string) => {
  const match = await bookings.createQuickMatch(
    { managedFieldId: venue.fieldId, name: `${marker}-${matchIds.length}`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 3, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: venue.nextKickoff().toISOString() },
    hostId,
  );
  matchIds.push(match.id);
  return match;
};
const sub = (side: 'HOME' | 'AWAY' = 'HOME') => ({ seat: 'SUBSTITUTE' as const, side, method: 'PAYMENT' as const, acceptPolicy: true as const });
const ticketOf = (matchId: string, playerId: string) => prisma.matchTicket.findFirstOrThrow({ where: { matchId, playerId }, orderBy: { createdAt: 'desc' }, include: { refunds: true, creditIssued: true } });
/** Moves a match's kick-off (and its T-30 lock) so that it is `hours` away. */
const kickoffIn = (matchId: string, hours: number) => {
  const startsAt = new Date(Date.now() + hours * 3_600_000);
  return prisma.match.update({ where: { id: matchId }, data: { startsAt, goNoGoAt: new Date(startsAt.getTime() - 30 * 60_000) } });
};

try {
  await venue.create();
  const [host, a, b, c, d, e, f] = await Promise.all(['host', 'a', 'b', 'c', 'd', 'e', 'f'].map((label) => player(label)));
  const match = await quickMatch(host);
  for (const userId of [a, b, c, d]) await buy.start(match.id, userId, sub(), randomUUID());

  // 1. More than 24 hours before: a choice is required; a credit (valid 3 years, ledgered) or a refund.
  assert((await codeOf(() => leaving.leave(match.id, a, undefined))) === 'TICKET_CHOICE_REQUIRED', 'A paid place was left without choosing a credit or a refund.');
  assert((await leaving.leave(match.id, a, 'CREDIT')).outcome === 'CREDIT_ISSUED', 'Leaving with a credit failed.');
  const aTicket = await ticketOf(match.id, a);
  const credit = aTicket.creditIssued!;
  assert(aTicket.status === 'CLOSED' && credit.status === 'AVAILABLE' && credit.userId === a && credit.originTicketId === aTicket.id, 'The credit is not linked to the ticket it came from.');
  assert(credit.expiresAt.getUTCFullYear() - credit.issuedAt.getUTCFullYear() === MATCH_CREDIT_VALID_YEARS, 'The credit is not valid for 3 years.');
  assert((await prisma.matchCreditEvent.count({ where: { creditId: credit.id, type: 'ISSUED', ticketId: aTicket.id } })) === 1, 'The credit was not ledgered.');
  assert((await prisma.matchParticipant.findFirstOrThrow({ where: { matchId: match.id, userId: a } })).status === 'LEFT', 'The player is still in the match.');
  assert((await leaving.leave(match.id, b, 'REFUND')).outcome === 'REFUNDED', 'Leaving with a refund failed.');
  const bTicket = await ticketOf(match.id, b);
  assert(bTicket.refunds.length === 1 && bTicket.refunds[0]!.amountCents === 8_000 && bTicket.refunds[0]!.source === 'TICKET_LEFT', 'The leave refund is not the ticket price.');
  assert((await codeOf(() => leaving.leave(match.id, b, 'REFUND'))) === 'NOT_IN_MATCH', 'A player could leave twice.');

  // 2. Rejoin after leaving: a new ticket, the old one keeps its history.
  const again = await buy.start(match.id, a, sub(), randomUUID());
  assert(again.state === 'CONFIRMED' && (await prisma.matchTicket.count({ where: { matchId: match.id, playerId: a } })) === 2, 'A player could not rejoin after leaving.');

  // 3. 24 hours or less before kick-off: nothing back, the place is released. From the T-30 lock: cannot leave.
  await kickoffIn(match.id, 20);
  assert((await leaving.leave(match.id, c, undefined)).outcome === 'FORFEITED', 'A late leaver got something back.');
  assert(!(await ticketOf(match.id, c)).refunds.length && !(await prisma.matchCredit.count({ where: { userId: c } })), 'A late leaver was refunded or credited.');
  await kickoffIn(match.id, 0.25);
  assert((await codeOf(() => leaving.leave(match.id, d, 'CREDIT'))) === 'LINEUP_LOCKED', 'A player could leave after the T-30 lock.');

  // 4. Cancellation: payers choose (late leavers too, D4), credit-paid tickets get the credit back, free owes nothing.
  await kickoffIn(match.id, 50);
  const creditTicketCheckout = await prisma.ticketCheckout.create({
    data: { matchId: match.id, payerId: e, kind: 'QUICK', method: 'CREDIT', amountCents: 0, idempotencyKey: randomUUID(), policyAcceptedAt: new Date(), termsVersion: '2.4', policyText: 'smoke', status: 'COMPLETED', completedAt: new Date() },
  });
  const creditTicket = await prisma.matchTicket.create({
    data: { matchId: match.id, checkoutId: creditTicketCheckout.id, playerId: e, payerId: e, side: 'AWAY', seat: 'SUBSTITUTE', method: 'CREDIT', amountCents: 0, status: 'CONFIRMED', confirmedAt: new Date() },
  });
  const used = await prisma.matchCredit.create({ data: { userId: e, reason: 'DEV_SEED', expiresAt: new Date(Date.now() + 4 * 365 * 86_400_000), status: 'USED', usedTicketId: creditTicket.id, usedAt: new Date(), closedAt: new Date() } });
  const cancel = () => serializableTransaction((tx) => repository.cancelInTx(tx, match.id, 'ORGANISER_CANCELLED'));
  await cancel();
  await cancel();
  const pending = await prisma.matchTicket.findMany({ where: { matchId: match.id, status: 'CHOICE_PENDING' } });
  assert(pending.length === 3 && new Set(pending.map(({ playerId }) => playerId)).size === 3 && pending.some(({ playerId }) => playerId === c), `Expected a, c and d to choose; got ${pending.length}.`);
  assert(pending.every(({ choiceDeadlineAt }) => choiceDeadlineAt && Math.round((choiceDeadlineAt.getTime() - Date.now()) / 86_400_000) === 7), 'The choice deadline is not 7 days.');
  const alerts = await prisma.notification.findMany({ where: { type: 'TICKET_CHOICE_REQUIRED', targetPath: `/matches/${match.id}` } });
  assert(alerts.length === 3 && alerts.every(({ message }) => message.includes('choose 1 match credit or a full refund') && message.includes('7 days')), 'Payers were not each told to choose once.');
  const emailJob = await prisma.durableJob.findFirstOrThrow({ where: { dedupeKey: `match-cancelled-email:${match.id}:${a}` } });
  assert((emailJob.payload as { choiceSeats?: number }).choiceSeats === 1, 'The cancellation email does not carry the choice.');
  const returned = await prisma.matchCredit.findFirst({ where: { userId: e, reason: 'CREDIT_RETURNED', sourceTicketId: creditTicket.id } });
  assert(returned?.status === 'AVAILABLE' && !returned.originTicketId && used.id !== returned.id, 'A credit-paid ticket did not get its credit back.');
  assert((await prisma.matchTicket.findUniqueOrThrow({ where: { id: creditTicket.id } })).outcome === 'CREDIT_RETURNED', 'The credit-paid ticket was not closed as credit returned.');

  // 5. Choosing: a credit or a refund, once. Without a choice: refunded automatically after 7 days, exactly once.
  assert((await leaving.choose(a, match.id, 'CREDIT')).resolved === 1, 'A could not choose a credit.');
  assert((await prisma.matchCredit.count({ where: { userId: a, reason: 'MATCH_CANCELLED', status: 'AVAILABLE' } })) === 1, 'The cancellation credit was not issued.');
  await leaving.choose(d, match.id, 'REFUND');
  assert((await ticketOf(match.id, d)).refunds[0]?.source === 'MATCH_CANCELLED', 'The chosen refund was not requested.');
  assert((await codeOf(() => leaving.choose(d, match.id, 'CREDIT'))) === 'NO_CHOICE_PENDING', 'A choice could be changed after it was made.');
  const cTicket = await ticketOf(match.id, c);
  assert((await codeOf(() => leaving.autoRefund(cTicket.id))) === 'TICKET_CHOICE_NOT_DUE', 'The automatic refund ran before 7 days.');
  const after = new Date(Date.now() + 8 * 86_400_000);
  await leaving.autoRefund(cTicket.id, after);
  await leaving.autoRefund(cTicket.id, after);
  const cRefunds = (await ticketOf(match.id, c)).refunds;
  assert(cRefunds.length === 1 && cRefunds[0]!.source === 'CHOICE_TIMEOUT', 'The automatic refund was not made exactly once.');
  assert(!(await prisma.matchCredit.count({ where: { userId: c } })), 'An unanswered choice silently became a credit.');

  // 6. A free match: nothing to choose.
  const free = await quickMatch(host);
  await prisma.match.update({ where: { id: free.id }, data: { freeOnFootyFinder: true, feeCents: 0 } });
  await buy.start(free.id, f, sub(), randomUUID());
  await serializableTransaction((tx) => repository.cancelInTx(tx, free.id, 'ORGANISER_CANCELLED'));
  assert((await ticketOf(free.id, f)).outcome === 'NOTHING_DUE', 'A free place had something to choose.');
  console.log('Ticket leave smoke passed: more than 24 hours before kick-off a paid place is left for 1 match credit (3 years, ledgered, linked to its ticket) or a refund of the ticket price, a choice is required, a player can rejoin; 24 hours or less gives nothing back and frees the place; nobody leaves after the T-30 lock; a cancellation (safe twice) gives each payer, late leavers included, one alert to choose a credit or a refund within 7 days, then refunds automatically exactly once (never a silent credit); credit-paid places get their credit back and free places owe nothing.');
} finally {
  const matchFilter = { matchId: { in: matchIds } };
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.providerRefund.deleteMany({ where: { ticket: matchFilter } });
  // The credit ledger is append-only, so credits, their tickets and these users stay (marked) in the disposable database.
  await prisma.durableJob.deleteMany({ where: { OR: matchIds.map((id) => ({ dedupeKey: { contains: id } })) } });
  await prisma.$disconnect();
}
