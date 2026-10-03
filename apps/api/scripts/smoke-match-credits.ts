import './assert-disposable-test-database.js';
import { removeTicketJobsSince } from './support/ticket-job-cleanup.js';
const smokeStartedAt = new Date();
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { TicketCheckoutService } from '../src/modules/tickets/ticket-checkout.service.js';
import { TicketLeaveService } from '../src/modules/tickets/ticket-leave.service.js';
import { expireMatchCredits, issueCreditInTx } from '../src/modules/tickets/match-credits.js';
import { managedVenueFixture } from './managed-venue-fixture.js';

/**
 * DEC-021 A4 on PostgreSQL: match credits. 1 credit = 1 ticket to any paid match; the oldest (soonest to expire) is
 * used first; two checkouts racing for the last credit cannot both use it; a free match never uses one; a disputed
 * payment blocks using credits; leaving a credit-paid place more than 24 hours before kick-off returns the credit
 * (never cash); credits expire after 3 years with a ledger entry (safe twice); every change is in the ledger.
 */
const marker = `credits-${randomUUID().slice(0, 8)}`;
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
// Paystack is "not configured" here: a credit checkout must never need it.
const buy = new TicketCheckoutService(undefined, undefined, undefined, { clientUrl: 'http://localhost:5173', demo: () => false, paystackEnabled: () => false, termsVersion: async () => '2.4' });
const leaving = new TicketLeaveService();
const matchIds: string[] = [];
const player = async (label: string) =>
  (await prisma.user.create({
    data: { email: `${marker}-${label}@smoke.invalid`, username: `cr_${randomUUID().slice(0, 12)}`, passwordHash: 'smoke-test-only', emailVerifiedAt: new Date(), onboardingCompletedAt: new Date(), profile: { create: { displayName: `${label} ${marker.slice(-4)}`, onboardingStatus: 'COMPLETE', gender: 'MALE' } } },
  })).id;
const quickMatch = async (hostId: string) => {
  const match = await bookings.createQuickMatch(
    { managedFieldId: venue.fieldId, name: `${marker}-${matchIds.length}`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 3, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: venue.nextKickoff().toISOString() },
    hostId,
  );
  matchIds.push(match.id);
  return match;
};
const withCredit = (method: 'CREDIT' | 'PAYMENT' = 'CREDIT') => ({ seat: 'SUBSTITUTE' as const, side: 'HOME' as const, method, acceptPolicy: true as const });
const grant = (userId: string, issuedAt = new Date()) => prisma.$transaction((tx) => issueCreditInTx(tx, { userId, reason: 'GOODWILL', now: issuedAt }));

try {
  await venue.create();
  const [host, a, b, c] = [await player('host'), await player('a'), await player('b'), await player('c')];
  const [m1, m2, m3] = [await quickMatch(host), await quickMatch(host), await quickMatch(host)];

  // 1. Oldest credit first; a credit ticket is placed straight away (no Paystack), with a USED ledger entry.
  const older = await grant(a, new Date(Date.now() - 400 * 86_400_000));
  const newer = await grant(a);
  const used = await buy.start(m1.id, a, withCredit(), randomUUID());
  assert(used.state === 'CONFIRMED' && used.method === 'CREDIT' && used.amountCents === 0 && !used.reference, 'A credit checkout did not confirm without a payment.');
  const olderNow = await prisma.matchCredit.findUniqueOrThrow({ where: { id: older.id } });
  assert(olderNow.status === 'USED' && olderNow.usedTicketId === used.ticketIds[0], 'The oldest credit was not the one used.');
  assert((await prisma.matchCredit.findUniqueOrThrow({ where: { id: newer.id } })).status === 'AVAILABLE', 'The newer credit was used too.');
  assert((await prisma.matchCreditEvent.count({ where: { creditId: older.id, type: 'USED', ticketId: used.ticketIds[0] } })) === 1, 'The use was not ledgered against the ticket.');
  assert((await buy.context(m2.id, a)).creditsAvailable === 1, 'The credit count is wrong.');

  // 2. The last credit, two checkouts at once: exactly one uses it.
  const race = await Promise.all([m2.id, m3.id].map((matchId) => codeOf(() => buy.start(matchId, a, withCredit(), randomUUID()))));
  assert(race.filter((code) => code === 'OK').length === 1 && race.includes('NO_MATCH_CREDIT'), `The race for the last credit gave ${race.join(', ')}.`);
  assert((await prisma.matchCredit.count({ where: { userId: a, status: 'AVAILABLE' } })) === 0, 'A credit was used twice or not at all.');

  // 3. A free match never spends a credit; a disputed payment blocks using credits.
  await grant(b);
  const free = await quickMatch(host);
  await prisma.match.update({ where: { id: free.id }, data: { freeOnFootyFinder: true, feeCents: 0 } });
  const freeTicket = await buy.start(free.id, b, withCredit(), randomUUID());
  assert(freeTicket.method === 'FREE' && (await prisma.matchCredit.count({ where: { userId: b, status: 'AVAILABLE' } })) === 1, 'A free match used a credit.');
  await prisma.user.update({ where: { id: b }, data: { bookingRestrictedAt: new Date() } });
  assert((await codeOf(() => buy.start(m1.id, b, withCredit(), randomUUID()))) === 'BOOKING_RESTRICTED', 'A credit could be used while a payment is disputed.');
  await prisma.user.update({ where: { id: b }, data: { bookingRestrictedAt: null } });

  // 4. Leaving a credit-paid place more than 24 hours before kick-off returns the credit, never cash.
  assert((await leaving.leave(m1.id, a, undefined)).outcome === 'CREDIT_RETURNED', 'Leaving a credit-paid place did not return the credit.');
  const back = await prisma.matchCredit.findFirstOrThrow({ where: { userId: a, reason: 'CREDIT_RETURNED' } });
  assert(back.status === 'AVAILABLE' && !back.originTicketId, 'The returned credit is wrong (a goodwill credit has no cash origin).');
  assert(!(await prisma.providerRefund.count({ where: { ticket: { matchId: m1.id, playerId: a } } })), 'A credit-paid place was refunded in cash.');

  // 5. Expiry after 3 years: EXPIRED with a ledger entry; running twice is safe.
  const ancient = await grant(c, new Date(Date.now() - (3 * 365 + 2) * 86_400_000));
  const expired = await expireMatchCredits(prisma);
  assert(expired >= 1, 'Nothing expired.');
  await expireMatchCredits(prisma);
  const gone = await prisma.matchCredit.findUniqueOrThrow({ where: { id: ancient.id }, include: { events: true } });
  assert(gone.status === 'EXPIRED' && gone.events.filter(({ type }) => type === 'EXPIRED').length === 1, 'The old credit did not expire exactly once.');
  assert((await codeOf(() => buy.start(m2.id, c, withCredit(), randomUUID()))) === 'NO_MATCH_CREDIT', 'An expired credit was usable.');
  console.log('Match credits smoke passed: 1 credit = 1 ticket placed without any payment, oldest credit first, the last credit used exactly once when two checkouts race, free matches never spend one, a disputed payment blocks credits, leaving a credit-paid place returns the credit (never cash), credits expire after 3 years once with a ledger entry, and every use is ledgered against its ticket.');
} finally {
  await removeTicketJobsSince(smokeStartedAt);
  // Credits and their ledger are append-only, so the credit holders, their tickets and these matches stay (marked) in
  // the disposable database. Jobs are removed so later smokes do not run them.
  await prisma.durableJob.deleteMany({ where: { OR: matchIds.map((id) => ({ dedupeKey: { contains: id } })) } });
  await prisma.$disconnect();
}
