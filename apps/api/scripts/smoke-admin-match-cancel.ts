import './assert-disposable-test-database.js';
import { removeTicketJobsSince } from './support/ticket-job-cleanup.js';
const smokeStartedAt = new Date();
import { refereeFixture } from './referee-fixture.js';
import { randomUUID } from 'node:crypto';
import type { CreateMatchInput } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { TestEmailProvider } from '../src/modules/auth/email.provider.js';
import { AdminMatchCancelService } from '../src/modules/matches/admin-match-cancel.service.js';
import { MATCH_CANCELLED_EMAIL_JOB_TYPE } from '../src/modules/matches/match-cancelled-email.js';
import { sendMatchCancelledEmail } from '../src/modules/matches/match-cancelled-email.jobs.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { TeamTicketsService } from '../src/modules/tickets/team-tickets.service.js';
import { TeamMatchesService } from '../src/modules/team-matches/team-matches.service.js';
import { assert, rejectsWith, teamMatchWorld } from './team-match-fixtures.js';
import { buyTicket } from './support/ticket-fixtures.js';

/**
 * CEO Q4 on PostgreSQL: the admin "Cancel match (weather/venue)" action. It reuses the tested
 * cancellation core, so every paid ticket's payer gets the credit-or-refund choice exactly once (DEC-021 A3);
 * it is audited with the admin's reason; players, the host, team members and the referee are
 * told with the fixed sentence (never an amount they didn't pay); it is refused after kick-off,
 * and for a team match from its 30-minute check (split window).
 */
const world = teamMatchWorld(`admin-cancel-${randomUUID()}`);
const referee = refereeFixture(`ref-${world.marker}`);
const matches = new MatchesService();
const teamMatches = new TeamMatchesService();
// DEC-021: team places are paid as match tickets (the demo operator confirms instantly).
const teamTickets = new TeamTicketsService(undefined, undefined, { demo: () => true, termsVersion: async () => '2.4' });
const cancel = new AdminMatchCancelService();
const emails = new TestEmailProvider();
let keyIndex = 0;
const key = () => `${world.marker}:k${keyIndex++}`;
const SENTENCE = 'was cancelled by FootyFinder because of the weather or a problem at the venue.';
const CHOICE_SENTENCE = 'You paid R80 for this match: choose 1 match credit or a full refund';
const choicesFor = (matchId: string, payerId?: string) =>
  prisma.matchTicket.count({ where: { matchId, status: 'CHOICE_PENDING', ...(payerId ? { payerId } : {}) } });
const notice = (matchId: string, userId: string) =>
  prisma.notification.findMany({ where: { userId, type: { in: ['MATCH_CANCELLED', 'TICKET_CHOICE_REQUIRED'] }, targetPath: { contains: matchId } } });

async function quickMatch(hostId: string) {
  const input: CreateMatchInput = {
    managedFieldId: world.fieldId, name: `${world.marker}-q${world.matchIds.length}`, format: 'FIVE_A_SIDE',
    substituteCapacityPerTeam: 0, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: world.nextKickoff().toISOString(),
  };
  const match = await matches.create(input, hostId);
  world.matchIds.push(match.id);
  await referee.assign(match.id);
  return match;
}
async function newTeam(label: string) {
  const owner = await world.user(`${label} owner`);
  const captain = await world.user(`${label} captain`);
  const team = await world.team(label, owner.id, [{ userId: captain.id, role: 'CAPTAIN' }]);
  return { owner, captain, team };
}
async function teamMatch(home: Awaited<ReturnType<typeof newTeam>>, otherSideMode: 'OPEN' | 'TEAMS_ONLY') {
  const input: CreateMatchInput = {
    managedFieldId: world.fieldId, name: `${world.marker}-t${world.matchIds.length}`, format: 'FIVE_A_SIDE',
    substituteCapacityPerTeam: 0, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC',
    startsAt: world.nextKickoff().toISOString(), playAsTeamId: home.team.id, otherSideMode, teamSubstituteCount: 0,
  };
  const match = await matches.create(input, home.owner.id);
  world.matchIds.push(match.id);
  await referee.assign(match.id);
  return match;
}
/** Sends every queued cancellation email for the match through the real handler; returns the texts by user. */
async function sendEmails(matchId: string) {
  const jobs = await prisma.durableJob.findMany({ where: { type: MATCH_CANCELLED_EMAIL_JOB_TYPE, dedupeKey: { startsWith: `match-cancelled-email:${matchId}:` } } });
  const texts = new Map<string, string>();
  for (const job of jobs) {
    const before = emails.messages.length;
    await sendMatchCancelledEmail(job.payload, emails);
    texts.set((job.payload as { userId: string }).userId, emails.messages[before]?.text ?? '');
  }
  return texts;
}

async function main() {
  await world.venue();
  await referee.create();
  const admin = await prisma.user.create({
    data: { email: `admin-${world.marker}@smoke.invalid`, username: `adm_${world.marker.slice(-12)}`, passwordHash: 'smoke-test-only', platformRole: 'ADMIN' },
  });

  // 1. Quick match before kick-off: every payer chooses once, audited, everyone told (host, players, referee).
  const host = await world.user('host');
  const players = [await world.user('p1'), await world.user('p2'), await world.user('p3')];
  const quick = await quickMatch(host.id);
  for (const [index, player] of players.entries())
    await buyTicket(quick.id, player.id, index % 2 ? 'AWAY' : 'HOME', key());
  const result = await cancel.cancel(quick.id, admin.id, { reason: 'Pitch waterlogged after storm' }, world.marker);
  assert(result.payersAskedToChoose === 3, `Expected 3 payers asked to choose, got ${result.payersAskedToChoose}.`);
  const cancelled = await prisma.match.findUniqueOrThrow({ where: { id: quick.id } });
  assert(cancelled.status === 'CANCELLED' && cancelled.cancellationReason === 'FOOTYFINDER_CANCELLED', 'The match was not cancelled with FOOTYFINDER_CANCELLED.');
  assert((await choicesFor(quick.id)) === 3, 'Every paid ticket was not given the credit-or-refund choice.');
  const audit = await prisma.adminAuditLog.findFirst({ where: { actorUserId: admin.id, action: 'MATCH_CANCELLED_BY_FOOTYFINDER', entityId: quick.id } });
  assert(audit && (audit.metadata as { reason?: string }).reason === 'Pitch waterlogged after storm', 'The cancellation was not audited with its reason.');
  const quickEmails = await sendEmails(quick.id);
  for (const player of players) {
    const [inApp] = await notice(quick.id, player.id);
    assert(inApp?.message.includes(SENTENCE) && inApp.message.includes(CHOICE_SENTENCE) && !/wallet/i.test(inApp.message), `Wrong player notice: ${inApp?.message}`);
    assert(quickEmails.get(player.id)?.includes(SENTENCE) && quickEmails.get(player.id)?.includes('choice=credit'), 'A player was not emailed both choices.');
  }
  const [hostNotice] = await notice(quick.id, host.id);
  assert(hostNotice?.message.includes(SENTENCE) && !/R\d/.test(hostNotice.message), 'The host (who did not pay) was told about a refund.');
  assert(!(await prisma.notification.findFirst({ where: { message: { contains: 'Pitch waterlogged' } } })), 'The admin reason reached a player.');
  const [refereeNotice] = await notice(quick.id, referee.userId);
  assert(refereeNotice?.message.includes(SENTENCE), 'The referee was not told.');
  assert(await rejectsWith(() => cancel.cancel(quick.id, admin.id, { reason: 'Second attempt' }, world.marker), 'ALREADY_CANCELLED'), 'A cancelled match was cancelled again.');
  assert((await choicesFor(quick.id)) === 3 && (await prisma.durableJob.count({ where: { dedupeKey: { in: (await prisma.matchTicket.findMany({ where: { matchId: quick.id }, select: { id: true } })).map(({ id }) => 'ticket-choice-auto-refund:' + id) } } })) === 3, 'A ticket was given the choice twice or not at all.');

  // 2. Quick match: allowed between T-30 and kick-off (payers still choose a credit or a refund), refused from kick-off.
  const late = await quickMatch(host.id);
  const latePlayer = await world.user('late');
  await buyTicket(late.id, latePlayer.id, 'HOME', key());
  const startsAt = new Date(late.startsAt);
  assert(await rejectsWith(() => cancel.cancel(late.id, admin.id, { reason: 'Too late' }, world.marker, startsAt), 'MATCH_STARTED'), 'A match was cancelled at kick-off.');
  assert((await prisma.match.findUniqueOrThrow({ where: { id: late.id } })).status !== 'CANCELLED', 'A refused cancellation changed the match.');
  await prisma.match.update({ where: { id: late.id }, data: { confirmedAt: new Date() } });
  await cancel.cancel(late.id, admin.id, { reason: 'Floodlights failed' }, world.marker, new Date(startsAt.getTime() - 10 * 60_000));
  assert((await choicesFor(late.id, latePlayer.id)) === 1, 'A confirmed quick match cancelled after T-30 did not give the player the choice.');

  // 3. Team match ("Teams only") before T-30: the captain who paid for their own place chooses a match credit or a
  //    refund (DEC-021 A3); the owner, who paid nothing, and the away team are not told about money.
  const home = await newTeam('home');
  const away = await newTeam('away');
  const tm = await teamMatch(home, 'TEAMS_ONLY');
  await teamMatches.loadTeam(tm.id, away.owner.id, { teamId: away.team.id, substituteCount: 0 });
  await teamTickets.checkout(tm.id, 'HOME', home.captain.id, { playerIds: [home.captain.id], method: 'PAYMENT', acceptPolicy: true }, key());
  await cancel.cancel(tm.id, admin.id, { reason: 'Venue closed by the city' }, world.marker);
  assert((await prisma.matchTicket.findFirstOrThrow({ where: { matchId: tm.id, payerId: home.captain.id } })).status === 'CHOICE_PENDING', 'The paid team place was not given the credit-or-refund choice.');
  const tmEmails = await sendEmails(tm.id);
  const [captainNotice] = await notice(tm.id, home.captain.id);
  assert(captainNotice?.message.includes(SENTENCE) && captainNotice.message.includes(CHOICE_SENTENCE) && !/wallet/i.test(captainNotice.message), `Wrong paying captain notice: ${captainNotice?.message}`);
  assert(tmEmails.get(home.captain.id)?.includes('choice=refund'), 'The paying captain was not emailed both choices.');
  const [ownerNotice] = await notice(tm.id, home.owner.id);
  assert(ownerNotice?.message.includes(SENTENCE) && !/R\d/.test(ownerNotice.message), `The owner was told about money they didn't pay: ${ownerNotice?.message}`);
  for (const userId of [away.owner.id, away.captain.id]) {
    const [inApp] = await notice(tm.id, userId);
    assert(inApp?.message.includes(SENTENCE) && !inApp.message.includes('fee') && !/R\d/.test(inApp.message),`The away team was told about money it didn't pay: ${inApp?.message}`);
  }

  // 4. Team match ("Open to both") with individual players: each chooses for their own R80 ticket.
  const home2 = await newTeam('home2');
  const open = await teamMatch(home2, 'OPEN');
  const individual = await world.user('individual');
  await buyTicket(open.id, individual.id, 'AWAY', key());
  await cancel.cancel(open.id, admin.id, { reason: 'Lightning warning' }, world.marker);
  assert((await choicesFor(open.id, individual.id)) === 1, 'An individual player was not given the choice.');
  const [individualNotice] = await notice(open.id, individual.id);
  assert(individualNotice?.message.includes(CHOICE_SENTENCE) && !/wallet/i.test(individualNotice.message), `Wrong individual notice: ${individualNotice?.message}`);

  // 5. Team match from its 30-minute check: refused (its fees are taken at T-30), nothing moves.
  const home3 = await newTeam('home3');
  const locked = await teamMatch(home3, 'TEAMS_ONLY');
  const goNoGoAt = (await prisma.match.findUniqueOrThrow({ where: { id: locked.id } })).goNoGoAt!;
  assert(await rejectsWith(() => cancel.cancel(locked.id, admin.id, { reason: 'Rain' }, world.marker, goNoGoAt), 'TEAM_MATCH_LOCKED'), 'A team match was cancelled from its T-30 check.');
  assert((await prisma.match.findUniqueOrThrow({ where: { id: locked.id } })).status !== 'CANCELLED', 'A refused team cancellation changed the match.');

  console.log('Admin match cancel smoke passed: every payer chooses a match credit or a refund exactly once (also between T-30 and kick-off), audited reason kept from players, host/player/referee/team notices and emails with the fixed sentence (never a wallet, never money someone did not pay), refused after kick-off and for team matches from T-30.');
}

try {
  await main();
} finally {
  await removeTicketJobsSince(smokeStartedAt);
  await referee.cleanupJobs(world.matchIds);
  // DEC-021: ticket rows for these matches (refunds first; tickets and checkouts restrict match deletion).
  const checkouts = await prisma.ticketCheckout.findMany({ where: { matchId: { in: world.matchIds } }, select: { providerPaymentId: true } });
  await prisma.providerRefund.deleteMany({ where: { ticket: { matchId: { in: world.matchIds } } } });
  await prisma.matchTicket.deleteMany({ where: { matchId: { in: world.matchIds } } });
  await prisma.ticketCheckout.deleteMany({ where: { matchId: { in: world.matchIds } } });
  await prisma.providerPayment.deleteMany({ where: { id: { in: checkouts.flatMap(({ providerPaymentId }) => (providerPaymentId ? [providerPaymentId] : [])) } } });
  await world.cleanup();
  await referee.cleanup();
  await prisma.$disconnect();
}
