import './assert-disposable-test-database.js';
import { removeTicketJobsSince } from './support/ticket-job-cleanup.js';
const smokeStartedAt = new Date();
import { refereeFixture } from './referee-fixture.js';
import { randomUUID } from 'node:crypto';
import { teamPaymentAlertAt, type CreateMatchInput } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { runOneDurableJob } from '../src/jobs/durable-jobs.js';
import { TestEmailProvider } from '../src/modules/auth/email.provider.js';
import { registerMatchCancelledEmailJobHandlers } from '../src/modules/matches/match-cancelled-email.jobs.js';
import { transitionMatchToStarted } from '../src/modules/matches/match-lifecycle.scheduler.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { MatchLineupService } from '../src/modules/match-lineup/match-lineup.service.js';
import { PaystackClient } from '../src/modules/payments/paystack.client.js';
import { registerTeamMatchJobHandlers } from '../src/modules/team-matches/team-match.jobs.js';
import { TeamMatchMetersService, teamGoNoGoDedupeKey } from '../src/modules/team-matches/team-match-meters.js';
import { TeamMatchesService } from '../src/modules/team-matches/team-matches.service.js';
import { expireTicketHold, TicketCheckoutService } from '../src/modules/tickets/ticket-checkout.service.js';
import { TicketLeaveService } from '../src/modules/tickets/ticket-leave.service.js';
import { registerTicketJobHandlers } from '../src/modules/tickets/ticket.jobs.js';
import { TicketSettlementService } from '../src/modules/tickets/ticket-settlement.service.js';
import { TeamTicketsService } from '../src/modules/tickets/team-tickets.service.js';
import { assert, rejectsWith, teamMatchWorld } from './team-match-fixtures.js';
import { FAKE_PAYSTACK_SECRET, FakePaystack } from './support/fake-paystack-server.js';

/**
 * DEC-019 as changed by DEC-021 (A5, CEO D1, D6, D7, D10) on PostgreSQL: team match places are paid as named match
 * tickets. The checklist shows every squad member as paid ("Paid by …"), being paid for, or unpaid; any squad
 * member pays for teammates; a credit only pays for your own seat; places are capped at the team's fee; the T-4h
 * alert reaches the owner/captains once with what is still needed; the T-2h cutoff cancels an unpaid fixture and
 * gives every payer the credit-or-refund choice; a double payment that slips through is refunded to its payer; a
 * withdrawing team's payers choose; subs can't drop below paid places; the T-30 check needs a referee and (for
 * individuals) every position; nothing is captured; the kick-off lineup holds only paid players; a captain cannot
 * remove a paid player; a player leaving a place someone else paid for leaves the choice to the payer.
 */
const world = teamMatchWorld(`team-tickets-${randomUUID()}`);
const referee = refereeFixture(`ref-${world.marker}`);
const matches = new MatchesService();
const teamMatches = new TeamMatchesService();
const meters = new TeamMatchMetersService();
const emails = new TestEmailProvider();
const termsVersion = async () => '2.4';
const fake = await new FakePaystack().start();
const gateway = new PaystackClient({ secretKey: FAKE_PAYSTACK_SECRET, baseUrl: fake.baseUrl, channels: ['card'] });
const settlement = new TicketSettlementService(gateway, undefined, ['card']);
const paystackCheckouts = new TicketCheckoutService(gateway, undefined, settlement, { clientUrl: 'http://localhost:5173', demo: () => false, paystackEnabled: () => true, termsVersion });
const demoTeam = new TeamTicketsService(undefined, undefined, { demo: () => true, termsVersion });
const paystackTeam = new TeamTicketsService(paystackCheckouts, undefined, { demo: () => false, termsVersion });
const individuals = new TicketCheckoutService(undefined, undefined, undefined, { clientUrl: 'http://localhost:5173', demo: () => true, paystackEnabled: () => false, termsVersion });
const leaving = new TicketLeaveService();
let keyIndex = 0;
const key = () => `${world.marker}:k${keyIndex++}`;
const pay = (service: TeamTicketsService, matchId: string, side: 'HOME' | 'AWAY', payerId: string, playerIds: string[], method: 'PAYMENT' | 'CREDIT' = 'PAYMENT') =>
  service.checkout(matchId, side, payerId, { playerIds, method, acceptPolicy: true }, key());

/** A team of six: owner, captain and four members (enough for 5 starters + 1 sub). */
async function newTeam(label: string) {
  const owner = await world.user(`${label} owner`);
  const captain = await world.user(`${label} captain`);
  const members = [];
  for (let index = 0; index < 4; index += 1) members.push(await world.user(`${label} member ${index}`));
  const team = await world.team(label, owner.id, [{ userId: captain.id, role: 'CAPTAIN' }, ...members.map(({ id }) => ({ userId: id, role: 'MEMBER' as const }))]);
  return { owner, captain, members, team, everyone: [owner, captain, ...members] };
}
type Team = Awaited<ReturnType<typeof newTeam>>;
async function publish(home: Team, otherSideMode: 'OPEN' | 'TEAMS_ONLY', subs: number) {
  const input: CreateMatchInput = {
    managedFieldId: world.fieldId, name: `${world.marker}-m${world.matchIds.length}`, format: 'FIVE_A_SIDE',
    substituteCapacityPerTeam: subs, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC',
    startsAt: world.nextKickoff().toISOString(), playAsTeamId: home.team.id, otherSideMode, teamSubstituteCount: subs,
  };
  const match = await matches.create(input, home.owner.id);
  world.matchIds.push(match.id);
  await referee.assign(match.id);
  return match;
}
/** Pays for every place a team's fee covers (5 starters + its subs), the owner paying for everyone. */
const payAll = async (matchId: string, side: 'HOME' | 'AWAY', team: Team, seats: number) =>
  pay(demoTeam, matchId, side, team.owner.id, team.everyone.slice(0, seats).map(({ id }) => id));
/** Moves a match so its kick-off is `hours` away (and its T-30 lock with it). */
const kickoffIn = (matchId: string, hours: number) => {
  const startsAt = new Date(Date.now() + hours * 3_600_000);
  return prisma.match.update({ where: { id: matchId }, data: { startsAt, goNoGoAt: new Date(startsAt.getTime() - 30 * 60_000) } });
};
async function reachT30(matchId: string) {
  const past = new Date(Date.now() - 1_000);
  await prisma.match.update({ where: { id: matchId }, data: { goNoGoAt: past } });
  await prisma.durableJob.update({ where: { dedupeKey: teamGoNoGoDedupeKey(matchId) }, data: { runAt: past } });
}
async function runQueuedGoNoGo(matchId: string) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const job = await prisma.durableJob.findUniqueOrThrow({ where: { dedupeKey: teamGoNoGoDedupeKey(matchId) } });
    if (job.status === 'SUCCEEDED') return job;
    if (!(await runOneDurableJob())) break;
  }
  return prisma.durableJob.findUniqueOrThrow({ where: { dedupeKey: teamGoNoGoDedupeKey(matchId) } });
}

async function main() {
  registerTeamMatchJobHandlers(undefined, emails);
  registerMatchCancelledEmailJobHandlers(emails);
  registerTicketJobHandlers();
  await world.venue();

  // 1. The checklist and paying for teammates ("Teams only", 1 sub: 6 places, R480).
  const home = await newTeam('home');
  const away = await newTeam('away');
  const goMatch = await publish(home, 'TEAMS_ONLY', 1);
  const closed = await demoTeam.roster(goMatch.id, 'HOME', home.members[0]!.id);
  assert(!closed.open && closed.closedReason === 'OPPONENT_NOT_FOUND' && closed.seats === 6 && closed.stillNeededCents === 48_000, 'The home checklist opened before an opponent was found.');
  assert(await rejectsWith(() => pay(demoTeam, goMatch.id, 'HOME', home.owner.id, [home.owner.id]), 'TEAM_PAYMENTS_NOT_OPEN'), 'A team paid before the other side was taken.');
  await teamMatches.loadTeam(goMatch.id, away.owner.id, { teamId: away.team.id, substituteCount: 0 });
  assert(await rejectsWith(() => demoTeam.roster(goMatch.id, 'HOME', away.owner.id), 'TEAM_FORBIDDEN'), "A team saw the other team's checklist.");
  // A plain member pays for themselves and two teammates (one Paystack transaction would cover all three).
  const first = await pay(demoTeam, goMatch.id, 'HOME', home.members[0]!.id, [home.members[0]!.id, home.members[1]!.id, home.members[2]!.id]);
  assert(first.state === 'CONFIRMED' && first.amountCents === 24_000 && first.ticketIds.length === 3, 'One payment did not cover three named players.');
  const roster = await demoTeam.roster(goMatch.id, 'HOME', home.owner.id);
  const paidFor = roster.members.find(({ userId }) => userId === home.members[1]!.id);
  assert(roster.paidSeats === 3 && roster.stillNeededCents === 24_000 && paidFor?.status === 'PAID' && paidFor.paidByDisplayName?.includes('home member 0'), 'The checklist does not show "Paid by …" and what is still needed.');
  assert(await prisma.notification.count({ where: { userId: home.members[1]!.id, title: 'Your place is paid' } }) === 1, 'A teammate was not told someone paid for their place.');
  assert(await rejectsWith(() => pay(demoTeam, goMatch.id, 'HOME', home.owner.id, [home.members[1]!.id]), 'ALREADY_PAID'), 'A paid player could be paid for again.');
  assert(await rejectsWith(() => pay(demoTeam, goMatch.id, 'HOME', home.owner.id, [home.captain.id], 'CREDIT'), 'CREDIT_OWN_SEAT_ONLY'), 'A credit paid for someone else.');
  const outsider = await world.user('outsider');
  assert(await rejectsWith(() => pay(demoTeam, goMatch.id, 'HOME', home.owner.id, [outsider.id]), 'NOT_A_TEAM_MEMBER'), 'A non-member was paid for.');
  // "Being paid for": a Paystack checkout holds the captain's place for 10 minutes.
  const holding = await pay(paystackTeam, goMatch.id, 'HOME', home.owner.id, [home.captain.id]);
  assert(holding.state === 'PROCESSING' && holding.authorizationUrl, 'The team checkout did not go to Paystack.');
  const beingPaid = (await demoTeam.roster(goMatch.id, 'HOME', home.members[3]!.id)).members.find(({ userId }) => userId === home.captain.id);
  assert(beingPaid?.status === 'BEING_PAID', 'A teammate being paid for is not shown as "Being paid for".');
  assert(await rejectsWith(() => pay(demoTeam, goMatch.id, 'HOME', home.members[3]!.id, [home.captain.id]), 'BEING_PAID_FOR'), 'Two people could pay for one player at once.');
  // A double payment slips through: the hold expires, someone else pays for the captain, then the first payment lands.
  await expireTicketHold(holding.checkoutId, new Date(Date.now() + 11 * 60_000));
  await pay(demoTeam, goMatch.id, 'HOME', home.members[3]!.id, [home.captain.id]);
  fake.pay(holding.reference!);
  await settlement.settleFromVerify(holding.reference!, 'webhook');
  const duplicate = await prisma.matchTicket.findFirstOrThrow({ where: { checkoutId: holding.checkoutId }, include: { refunds: true } });
  assert(duplicate.outcome === 'DUPLICATE_REFUNDED' && duplicate.refunds[0]?.source === 'DUPLICATE_PAYMENT' && duplicate.refunds[0].amountCents === 8_000, 'A double payment was not refunded to its payer.');
  await pay(demoTeam, goMatch.id, 'HOME', home.owner.id, [home.owner.id]);
  // 5 of 6 places paid: a seventh squad member can't be added on top.
  const extra = await world.user('home extra');
  await prisma.teamMembership.create({ data: { teamId: home.team.id, userId: extra.id, role: 'MEMBER' } });
  assert(await rejectsWith(() => pay(demoTeam, goMatch.id, 'HOME', home.owner.id, [home.members[3]!.id, extra.id]), 'TEAM_SEATS_FULL'), 'More places were paid for than the fee covers.');
  await pay(demoTeam, goMatch.id, 'HOME', home.owner.id, [home.members[3]!.id]);
  assert((await demoTeam.roster(goMatch.id, 'HOME', home.owner.id)).stillNeededCents === 0, 'The home team is not shown as fully paid.');
  // D6: a captain cannot take a paid player out of the lineup; subs can't drop below the places paid for.
  assert(await rejectsWith(() => meters.changeSubstitutes(goMatch.id, 'HOME', home.owner.id, 0), 'SUBSTITUTES_BELOW_PAID'), 'Subs dropped below the places already paid for.');
  const homeSide = await prisma.matchTeam.findUniqueOrThrow({ where: { matchId_side: { matchId: goMatch.id, side: 'HOME' } } });
  const paidSelection = await prisma.teamMatchSelection.create({ data: { matchTeamId: homeSide.id, userId: home.members[1]!.id, status: 'SELECTED_SUBSTITUTE' } });
  assert(await rejectsWith(() => new MatchLineupService().removeSubstitute(goMatch.id, 'HOME', home.members[1]!.id, home.owner.id), 'PAID_PLAYER_IN_LINEUP'), 'A captain removed a paid player from the lineup.');
  await payAll(goMatch.id, 'AWAY', away, 5);
  // An unpaid squad member picked into the lineup is left out of the kick-off record (D6).
  await prisma.teamMatchSelection.create({ data: { matchTeamId: homeSide.id, userId: outsider.id, status: 'SELECTED_SUBSTITUTE' } }).catch(() => undefined);
  await reachT30(goMatch.id);
  const goJob = await runQueuedGoNoGo(goMatch.id);
  assert(goJob.status === 'SUCCEEDED', `The team go/no-go job did not succeed: ${goJob.status} ${goJob.lastError}`);
  assert((await meters.decideGoNoGo(goMatch.id)).outcome === 'ALREADY_DECIDED', 'A second decision was not a no-op.');
  assert((await prisma.match.findUniqueOrThrow({ where: { id: goMatch.id } })).confirmedAt, 'Two fully paid teams did not confirm the match.');
  assert(!(await prisma.teamWalletHold.count({ where: { matchId: goMatch.id } })), 'Team wallet money was involved.');
  await prisma.match.update({ where: { id: goMatch.id }, data: { goNoGoAt: new Date(Date.now() - 3_600_000), startsAt: new Date(Date.now() - 60_000) } });
  assert(await transitionMatchToStarted(goMatch.id), 'A confirmed team match did not kick off.');
  const lineup = await prisma.matchLineupEntry.findMany({ where: { matchId: goMatch.id } });
  assert(lineup.some(({ userId }) => userId === paidSelection.userId) && !lineup.some(({ userId }) => userId === outsider.id), 'The kick-off lineup is not limited to paid players.');
  assert((await prisma.venuePayable.findUniqueOrThrow({ where: { matchId: goMatch.id } })).amountCents === 50_000, 'The venue payable is not the admin-only price snapshot.');

  // 2. T-4h alert and T-2h cutoff: an unpaid team is alerted once, then the fixture is cancelled (TEAM_UNPAID)
  //    and every payer chooses a credit or a refund.
  const homeB = await newTeam('home-b');
  const awayB = await newTeam('away-b');
  const unpaid = await publish(homeB, 'TEAMS_ONLY', 0);
  await teamMatches.loadTeam(unpaid.id, awayB.owner.id, { teamId: awayB.team.id, substituteCount: 0 });
  await payAll(unpaid.id, 'AWAY', awayB, 5);
  await pay(demoTeam, unpaid.id, 'HOME', homeB.captain.id, [homeB.captain.id, homeB.members[0]!.id]);
  await kickoffIn(unpaid.id, 3);
  const alerts = await meters.paymentAlert(unpaid.id);
  await meters.paymentAlert(unpaid.id);
  assert(alerts.length === 2 && alerts.every(({ userId, message }) => [homeB.owner.id, homeB.captain.id].includes(userId) && message.includes('Pay the remaining R240')), `The T-4h alert is wrong: ${JSON.stringify(alerts.map(({ message }) => message))}`);
  assert((await prisma.durableJob.count({ where: { type: 'TICKET_EMAIL', dedupeKey: { startsWith: `ticket-email:TEAM_PAYMENT_DUE:${unpaid.id}` } } })) === 2, 'The T-4h alert emails were not queued once each.');
  assert(teamPaymentAlertAt(new Date()).getTime() < Date.now(), 'Alert timing helper is broken.');
  assert(await rejectsWith(() => meters.paymentCutoff(unpaid.id), 'TEAM_PAYMENT_CUTOFF_NOT_DUE'), 'The cutoff ran before T-2h.');
  await kickoffIn(unpaid.id, 1.5);
  assert((await meters.paymentCutoff(unpaid.id)).cancelled, 'An unpaid team match was not cancelled at T-2h.');
  assert((await prisma.match.findUniqueOrThrow({ where: { id: unpaid.id } })).cancellationReason === 'TEAM_UNPAID', 'The cutoff reason is not TEAM_UNPAID.');
  assert((await prisma.matchTicket.count({ where: { matchId: unpaid.id, status: 'CHOICE_PENDING' } })) === 7, 'Not every paid place was given the credit-or-refund choice.');
  assert((await prisma.notification.count({ where: { userId: homeB.captain.id, type: 'TICKET_CHOICE_REQUIRED' } })) === 1, 'The paying captain was not asked to choose once.');

  // 3. A team withdraws: its payers choose a credit or a refund; the side reopens.
  const homeC = await newTeam('home-c');
  const awayC = await newTeam('away-c');
  const withdrawMatch = await publish(homeC, 'TEAMS_ONLY', 0);
  await teamMatches.loadTeam(withdrawMatch.id, awayC.owner.id, { teamId: awayC.team.id, substituteCount: 0 });
  await pay(demoTeam, withdrawMatch.id, 'AWAY', awayC.captain.id, [awayC.captain.id, awayC.owner.id]);
  await teamMatches.withdrawTeam(withdrawMatch.id, awayC.owner.id);
  assert((await prisma.matchTicket.count({ where: { matchId: withdrawMatch.id, payerId: awayC.captain.id, status: 'CHOICE_PENDING' } })) === 2, "The withdrawing team's payer was not asked to choose.");
  assert((await prisma.durableJob.count({ where: { dedupeKey: `ticket-email:WITHDRAWAL_CHOICE:${withdrawMatch.id}:${awayC.captain.id}` } })) === 1, 'The withdrawal choice email was not queued.');
  assert((await prisma.match.findUniqueOrThrow({ where: { id: withdrawMatch.id } })).otherSideTakenBy === null, 'The side did not reopen.');

  // 4. A player leaves a place a teammate paid for, more than 24 hours out: the payer chooses (A5), both told.
  const homeD = await newTeam('home-d');
  const awayD = await newTeam('away-d');
  const leaveMatch = await publish(homeD, 'TEAMS_ONLY', 0);
  await teamMatches.loadTeam(leaveMatch.id, awayD.owner.id, { teamId: awayD.team.id, substituteCount: 0 });
  await pay(demoTeam, leaveMatch.id, 'HOME', homeD.owner.id, [homeD.members[0]!.id]);
  assert((await leaving.leave(leaveMatch.id, homeD.members[0]!.id, undefined)).outcome === 'PAYER_CHOOSES', 'The leaver decided for the payer.');
  assert((await prisma.matchTicket.findFirstOrThrow({ where: { matchId: leaveMatch.id, playerId: homeD.members[0]!.id } })).status === 'CHOICE_PENDING', "The payer was not given the choice.");
  assert((await prisma.durableJob.count({ where: { type: 'TICKET_EMAIL', dedupeKey: { startsWith: 'ticket-email:SEAT_LEFT:' }, payload: { path: ['userId'], equals: homeD.owner.id } } })) === 1, 'The payer was not emailed.');

  // 5. "Open to both": individuals on every away position and the home team paid: GO. One position empty: NO-GO.
  const homeE = await newTeam('home-e');
  const openGo = await publish(homeE, 'OPEN', 0);
  const awaySlots = await prisma.formationSlot.findMany({ where: { matchId: openGo.id, team: 'AWAY' }, orderBy: { slotIndex: 'asc' } });
  for (const slot of awaySlots) {
    const player = await world.user(`open ${slot.slotIndex}`);
    await individuals.start(openGo.id, player.id, { seat: 'POSITION', side: 'AWAY', slotId: slot.id, method: 'PAYMENT', acceptPolicy: true }, key());
  }
  await payAll(openGo.id, 'HOME', homeE, 5);
  await reachT30(openGo.id);
  assert((await meters.decideGoNoGo(openGo.id)).outcome === 'CONFIRMED', 'A paid home team and full away positions did not confirm the match.');
  const homeF = await newTeam('home-f');
  const openShort = await publish(homeF, 'OPEN', 0);
  const lone = await world.user('lone');
  await individuals.start(openShort.id, lone.id, { seat: 'SUBSTITUTE', side: 'AWAY', method: 'PAYMENT', acceptPolicy: true }, key());
  await payAll(openShort.id, 'HOME', homeF, 5);
  await reachT30(openShort.id);
  assert((await meters.decideGoNoGo(openShort.id)).outcome === 'CANCELLED', 'An open match with empty positions went ahead.');
  assert((await prisma.match.findUniqueOrThrow({ where: { id: openShort.id } })).cancellationReason === 'POSITIONS_UNFILLED', 'The individuals no-go reason is wrong.');
  assert((await prisma.matchTicket.count({ where: { matchId: openShort.id, status: 'CHOICE_PENDING' } })) === 6, 'The individual and the home payers were not all asked to choose.');

  // 6. No referee at T-30 (paid teams): NO_REFEREE. Nobody took the other side: NO_OPPONENT (a stale job is reclaimed).
  const homeG = await newTeam('home-g');
  const awayG = await newTeam('away-g');
  const refMatch = await publish(homeG, 'TEAMS_ONLY', 0);
  await teamMatches.loadTeam(refMatch.id, awayG.owner.id, { teamId: awayG.team.id, substituteCount: 0 });
  await payAll(refMatch.id, 'HOME', homeG, 5);
  await payAll(refMatch.id, 'AWAY', awayG, 5);
  await prisma.match.update({ where: { id: refMatch.id }, data: { refereeUserId: null, refereeAssignedAt: null } });
  await reachT30(refMatch.id);
  await meters.decideGoNoGo(refMatch.id);
  assert((await prisma.match.findUniqueOrThrow({ where: { id: refMatch.id } })).cancellationReason === 'NO_REFEREE', 'The team no-go did not give NO_REFEREE.');
  const homeH = await newTeam('home-h');
  const lonely = await publish(homeH, 'OPEN', 0);
  await reachT30(lonely.id);
  await prisma.durableJob.update({ where: { dedupeKey: teamGoNoGoDedupeKey(lonely.id) }, data: { status: 'RUNNING', lockedAt: new Date(Date.now() - 86_400_000), attempts: 1 } });
  assert((await runQueuedGoNoGo(lonely.id)).status === 'SUCCEEDED', 'A stale team go/no-go job was not reclaimed.');
  assert((await prisma.match.findUniqueOrThrow({ where: { id: lonely.id } })).cancellationReason === 'NO_OPPONENT', 'A match with no opponent was not cancelled at T-30.');

  // 7. After the T-2h cutoff: payments and subs changes are closed.
  const homeI = await newTeam('home-i');
  const awayI = await newTeam('away-i');
  const late = await publish(homeI, 'TEAMS_ONLY', 0);
  await teamMatches.loadTeam(late.id, awayI.owner.id, { teamId: awayI.team.id, substituteCount: 0 });
  await kickoffIn(late.id, 1.5);
  assert(await rejectsWith(() => pay(demoTeam, late.id, 'HOME', homeI.owner.id, [homeI.owner.id]), 'TEAM_PAYMENTS_CLOSED'), 'A team paid after the T-2h cutoff.');
  assert(await rejectsWith(() => meters.changeSubstitutes(late.id, 'HOME', homeI.owner.id, 1), 'TEAM_PAYMENTS_CLOSED'), 'Subs changed after the T-2h cutoff.');
  assert(await rejectsWith(() => meters.fill(), 'TEAM_METER_RETIRED'), 'The fill meter still works.');

  console.log('Team tickets smoke passed: named checklist (paid by / being paid for / unpaid, members only), one payment for several named players, credits for your own seat only, places capped at the fee, a slipped double payment refunded to its payer, paid players kept in the lineup, subs never below paid places, T-4h alert once with what is still needed, T-2h cutoff cancels an unpaid fixture with the credit-or-refund choice for every payer, a withdrawing team\'s payers choose, a leaver\'s payer chooses, T-30 needs a referee and every individuals position, nothing captured, the kick-off lineup holds only paid players, and payments and subs close at T-2h.');
}

try {
  await main();
} finally {
  await removeTicketJobsSince(smokeStartedAt);
  await world.cleanup();
  await referee.cleanup();
  await fake.stop();
  await prisma.$disconnect();
}
