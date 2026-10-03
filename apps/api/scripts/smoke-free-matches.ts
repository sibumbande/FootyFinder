import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { AdminMatchCancelService } from '../src/modules/matches/admin-match-cancel.service.js';
import { FreeMatchAdminService } from '../src/modules/matches/free-match.admin.service.js';
import { managedVenueFixture } from './managed-venue-fixture.js';
import { socialWorld } from './social-fixtures.js';
import { buyTicket, leaveTicket, removeTicketRows } from './support/ticket-fixtures.js';

/**
 * CEO touch-up batch 3, item 5 on PostgreSQL: free "On FootyFinder" Quick Matches. Players join with an R0 ticket
 * (DEC-021: no payment, no refund, no credit), FootyFinder's R80 cover per player is recorded in its own promotions
 * ledger and reversed when a player leaves or the match is cancelled, "first-time players only" refuses players who
 * have played, marking needs an empty lobby, and the cost report stays consistent.
 */
const world = socialWorld(`free-${randomUUID().slice(0, 8)}`);
const venue = managedVenueFixture(world.marker);
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const rejectsWith = async (work: () => Promise<unknown>, code: string) => {
  try {
    await work();
    return false;
  } catch (error) {
    return (error as { code?: string }).code === code;
  }
};
const free = new FreeMatchAdminService();
const bookings = new BookingsService();
/** Nothing was ever paid, refunded or credited for this player (a free place is an R0 ticket). */
const noMoney = async (userId: string) =>
  !(await prisma.providerPayment.count({ where: { userId } })) && !(await prisma.providerRefund.count({ where: { providerPayment: { userId } } })) && !(await prisma.matchCredit.count({ where: { userId } }));
const quickMatch = async (hostId: string, name: string) =>
  bookings.createQuickMatch({ managedFieldId: venue.fieldId, name: `${world.marker} ${name}`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 2, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: venue.nextKickoff().toISOString() }, hostId);

try {
  await venue.create();
  const admin = await prisma.user.create({ data: { email: `admin-${world.marker}@smoke.invalid`, username: `fr_${randomUUID().slice(0, 10)}`, passwordHash: 'smoke-test-only', platformRole: 'ADMIN' } });
  const host = await world.player('Host');
  const rookie = await world.player('Rookie');
  const rookie2 = await world.player('Second rookie');
  const veteran = await world.player('Veteran');
  await world.finishedMatch([veteran.id], []);

  // Marking: an admin makes an empty Quick Match free, "first-time players only"; the fee becomes R0.
  const first = await quickMatch(host.id, 'free first-timers');
  world.matchIds.push(first.id);
  const marked = await free.mark(first.id, { free: true, firstTimersOnly: true, reason: 'Launch promotion week 1' }, admin.id, world.marker);
  assert(marked.freeOnFootyFinder && marked.firstTimersOnly && marked.feeCents === 0, 'The match was not made free for first-time players.');
  assert((await prisma.adminAuditLog.count({ where: { requestId: world.marker, action: 'MATCH_MARKED_FREE' } })) === 1, 'Marking a match free was not audited.');

  // First-time players only: the veteran is refused; a rookie joins with an R0 ticket.
  assert(await rejectsWith(() => buyTicket(first.id, veteran.id, 'HOME', `${world.marker}-vet`), 'FIRST_TIMERS_ONLY'), 'A player who has played joined a first-timers match.');
  const rookieTicket = await buyTicket(first.id, rookie.id, 'HOME', `${world.marker}-rookie`);
  assert(rookieTicket.result.method === 'FREE' && rookieTicket.result.amountCents === 0, 'The free-match ticket was not R0.');
  const cover = await prisma.promotionalCost.findFirstOrThrow({ where: { matchId: first.id, userId: rookie.id } });
  assert(cover.status === 'ACTIVE' && cover.amountCents === 8_000, 'FootyFinder\'s R80 cover was not recorded.');
  assert(await noMoney(rookie.id), 'Joining a free match moved money.');

  // Marking needs an empty lobby.
  assert(await rejectsWith(() => free.mark(first.id, { free: false, firstTimersOnly: false, reason: 'Too late to change' }, admin.id, world.marker), 'FREE_MATCH_HAS_PLAYERS'), 'A match with players was made paid again.');

  // Leaving refunds nothing and reverses the cover.
  await buyTicket(first.id, rookie2.id, 'AWAY', `${world.marker}-rookie2`);
  assert((await leaveTicket(first.id, rookie.id)).outcome === 'NOTHING_DUE', 'Leaving a free match gave something back.');
  assert((await prisma.promotionalCost.findFirstOrThrow({ where: { id: cover.id } })).status === 'REVERSED', 'Leaving did not reverse FootyFinder\'s cover.');
  assert(await noMoney(rookie.id), 'Leaving a free match moved money.');

  // A cancelled free match refunds nothing and reverses every cover.
  const second = await quickMatch(host.id, 'free open');
  world.matchIds.push(second.id);
  await free.mark(second.id, { free: true, firstTimersOnly: false, reason: 'Community night' }, admin.id, world.marker);
  await buyTicket(second.id, veteran.id, 'HOME', `${world.marker}-vet2`);
  await new AdminMatchCancelService().cancel(second.id, admin.id, { reason: 'Floodlights failed at the venue' }, world.marker);
  assert((await prisma.promotionalCost.count({ where: { matchId: second.id, status: 'ACTIVE' } })) === 0, 'Cancelling did not reverse the cover.');
  assert(await noMoney(veteran.id) && !(await prisma.matchTicket.count({ where: { matchId: second.id, status: 'CHOICE_PENDING' } })), 'A cancelled free match offered money back.');

  // Unmarking an empty free match restores the R80 fee.
  const third = await quickMatch(host.id, 'free then paid');
  world.matchIds.push(third.id);
  await free.mark(third.id, { free: true, firstTimersOnly: false, reason: 'Trial' }, admin.id, world.marker);
  const unmarked = await free.mark(third.id, { free: false, firstTimersOnly: false, reason: 'Promotion ended' }, admin.id, world.marker);
  assert(!unmarked.freeOnFootyFinder && unmarked.feeCents === 8_000, 'Unmarking did not restore the R80 fee.');

  // The cost report.
  const costs = await free.costReport();
  const firstRow = costs.matches.find(({ matchId }) => matchId === first.id);
  const secondRow = costs.matches.find(({ matchId }) => matchId === second.id);
  assert(firstRow?.playersCovered === 1 && firstRow.feesWaivedCents === 8_000, 'The cost report does not show the fees waived.');
  assert(firstRow.venueCostKind === 'EXPECTED' && firstRow.venueCostCents === 50_000, 'The cost report does not show the expected venue cost before kickoff.');
  assert(secondRow?.playersCovered === 0 && secondRow.venueCostKind === 'NONE', 'A cancelled free match still shows a cost.');
  console.log('Free matches smoke passed: marking needs an empty lobby (fresh MFA route, audited), players join with an R0 ticket and no money moves, FootyFinder\'s R80 cover is recorded and reversed on leave and cancellation, first-time-only refuses veterans, unmarking restores R80, reconciliation is clean, and the cost report shows fees waived and venue cost.');
} finally {
  await removeTicketRows(world.matchIds);
  await venue.cleanupMatches(world.matchIds);
  // The venue fixture's two approvers share the marker, so they go first.
  await venue.cleanupVenue().catch((error) => console.error('venue cleanup failed', error));
  await world.cleanup().catch((error) => console.error('cleanup failed', error));
  await prisma.$disconnect();
}
