import './assert-disposable-test-database.js';
import { refereeFixture } from './referee-fixture.js';
import { randomUUID } from 'node:crypto';
import type { CreateMatchInput } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { TestEmailProvider } from '../src/modules/auth/email.provider.js';
import { AdminMatchCancelService } from '../src/modules/matches/admin-match-cancel.service.js';
import { MATCH_CANCELLED_EMAIL_JOB_TYPE } from '../src/modules/matches/match-cancelled-email.js';
import { sendMatchCancelledEmail } from '../src/modules/matches/match-cancelled-email.jobs.js';
import { MatchesRepository } from '../src/modules/matches/matches.repository.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { TeamMatchMetersService } from '../src/modules/team-matches/team-match-meters.js';
import { TeamMatchesService } from '../src/modules/team-matches/team-matches.service.js';
import { assert, rejectsWith, teamMatchWorld } from './team-match-fixtures.js';

/**
 * CEO Q4 on PostgreSQL: the admin "Cancel match (weather/venue)" action. It reuses the tested
 * cancel-and-refund core, so each fee comes back exactly once and held team money is released;
 * it is audited with the admin's reason; players, the host, team members and the referee are
 * told with the fixed sentence (never an amount they didn't pay); it is refused after kick-off,
 * and for a team match from its 30-minute check (split window).
 */
const world = teamMatchWorld(`admin-cancel-${randomUUID()}`);
const referee = refereeFixture(`ref-${world.marker}`);
const matches = new MatchesService();
const repository = new MatchesRepository();
const teamMatches = new TeamMatchesService();
const meters = new TeamMatchMetersService();
const cancel = new AdminMatchCancelService();
const emails = new TestEmailProvider();
let keyIndex = 0;
const key = () => `${world.marker}:k${keyIndex++}`;
const SENTENCE = 'was cancelled by FootyFinder because of the weather or a problem at the venue.';
const TEAM_SENTENCE = "Your team's fee has been returned to your team wallet.";

const balance = async (userId: string) => (await prisma.walletAccount.findUniqueOrThrow({ where: { userId } })).balanceCents;
const teamBalance = async (teamId: string) => (await prisma.teamWalletAccount.findUniqueOrThrow({ where: { teamId } })).balanceCents;
const notice = (matchId: string, userId: string) =>
  prisma.notification.findMany({ where: { userId, type: 'MATCH_CANCELLED', targetPath: { contains: matchId } } });

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
  await world.contribute(team.id, owner.id, 100_000, `${label}-fund`);
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

  // 1. Quick match before kick-off: every fee back once, audited, everyone told (host, players, referee).
  const host = await world.user('host');
  const players = [await world.user('p1'), await world.user('p2'), await world.user('p3')];
  const quick = await quickMatch(host.id);
  const before = new Map<string, number>();
  for (const player of players) before.set(player.id, await balance(player.id));
  for (const [index, player] of players.entries())
    await repository.join(quick.id, player.id, { team: index % 2 ? 'AWAY' : 'HOME' }, key());
  assert(await balance(players[0]!.id) === before.get(players[0]!.id)! - 8_000, 'The join did not take R80.');
  const result = await cancel.cancel(quick.id, admin.id, { reason: 'Pitch waterlogged after storm' }, world.marker);
  assert(result.refundedUserCount === 3, `Expected 3 refunds, got ${result.refundedUserCount}.`);
  const cancelled = await prisma.match.findUniqueOrThrow({ where: { id: quick.id } });
  assert(cancelled.status === 'CANCELLED' && cancelled.cancellationReason === 'FOOTYFINDER_CANCELLED', 'The match was not cancelled with FOOTYFINDER_CANCELLED.');
  for (const player of players) assert(await balance(player.id) === before.get(player.id), 'A player was not refunded in full.');
  const credits = await prisma.walletTransaction.count({ where: { type: 'MATCH_CANCELLATION_CREDIT', referenceId: { in: (await prisma.matchPayment.findMany({ where: { matchId: quick.id } })).map(({ id }) => id) } } });
  assert(credits === 3, `Expected exactly 3 cancellation credits, got ${credits}.`);
  const audit = await prisma.adminAuditLog.findFirst({ where: { actorUserId: admin.id, action: 'MATCH_CANCELLED_BY_FOOTYFINDER', entityId: quick.id } });
  assert(audit && (audit.metadata as { reason?: string }).reason === 'Pitch waterlogged after storm', 'The cancellation was not audited with its reason.');
  const quickEmails = await sendEmails(quick.id);
  for (const player of players) {
    const [inApp] = await notice(quick.id, player.id);
    assert(inApp?.message.includes(SENTENCE) && inApp.message.includes('Your R80 has been refunded to your FootyFinder wallet.'), `Wrong player notice: ${inApp?.message}`);
    assert(quickEmails.get(player.id)?.includes(SENTENCE), 'A player was not emailed.');
  }
  const [hostNotice] = await notice(quick.id, host.id);
  assert(hostNotice?.message.includes(SENTENCE) && !/R\d/.test(hostNotice.message), 'The host (who did not pay) was told about a refund.');
  assert(!(await prisma.notification.findFirst({ where: { userId: host.id, type: 'MATCH_CANCELLED', message: { contains: 'Pitch waterlogged' } } })), 'The admin reason reached a player.');
  const [refereeNotice] = await notice(quick.id, referee.userId);
  assert(refereeNotice?.message.includes(SENTENCE), 'The referee was not told.');
  assert(await rejectsWith(() => cancel.cancel(quick.id, admin.id, { reason: 'Second attempt' }, world.marker), 'ALREADY_CANCELLED'), 'A cancelled match was cancelled again.');
  const firstPayment = await prisma.matchPayment.findFirstOrThrow({ where: { matchId: quick.id, userId: players[0]!.id } });
  assert(await prisma.walletTransaction.count({ where: { type: 'MATCH_CANCELLATION_CREDIT', referenceId: firstPayment.id } }) === 1, 'A fee was refunded twice.');

  // 2. Quick match: allowed between T-30 and kick-off (player fees are still refundable), refused from kick-off.
  const late = await quickMatch(host.id);
  const latePlayer = await world.user('late');
  const lateBefore = await balance(latePlayer.id);
  await repository.join(late.id, latePlayer.id, { team: 'HOME' }, key());
  const startsAt = new Date(late.startsAt);
  assert(await rejectsWith(() => cancel.cancel(late.id, admin.id, { reason: 'Too late' }, world.marker, startsAt), 'MATCH_STARTED'), 'A match was cancelled at kick-off.');
  assert((await prisma.match.findUniqueOrThrow({ where: { id: late.id } })).status !== 'CANCELLED', 'A refused cancellation changed the match.');
  await prisma.match.update({ where: { id: late.id }, data: { confirmedAt: new Date() } });
  await cancel.cancel(late.id, admin.id, { reason: 'Floodlights failed' }, world.marker, new Date(startsAt.getTime() - 10 * 60_000));
  assert(await balance(latePlayer.id) === lateBefore, 'A confirmed quick match cancelled after T-30 did not refund the player.');

  // 3. Team match ("Teams only") before T-30: the home team's held fee goes back; the away team, which
  //    held nothing, is not told about a fee.
  const home = await newTeam('home');
  const away = await newTeam('away');
  const tm = await teamMatch(home, 'TEAMS_ONLY');
  await teamMatches.loadTeam(tm.id, away.owner.id, { teamId: away.team.id, substituteCount: 0 });
  const homeBefore = await teamBalance(home.team.id);
  await meters.fill(tm.id, 'HOME', home.captain.id, 20_000, key());
  await cancel.cancel(tm.id, admin.id, { reason: 'Venue closed by the city' }, world.marker);
  assert(await teamBalance(home.team.id) === homeBefore, 'The home team wallet did not get its held fee back.');
  assert(await prisma.teamWalletHold.count({ where: { matchId: tm.id, status: 'ACTIVE' } }) === 0, 'Team money is still held.');
  const tmEmails = await sendEmails(tm.id);
  for (const userId of [home.owner.id, home.captain.id]) {
    const [inApp] = await notice(tm.id, userId);
    assert(inApp?.message.includes(SENTENCE) && inApp.message.includes(TEAM_SENTENCE), `Wrong home team notice: ${inApp?.message}`);
    assert(tmEmails.get(userId)?.includes(TEAM_SENTENCE), 'A home team member was not emailed about the fee.');
  }
  for (const userId of [away.owner.id, away.captain.id]) {
    const [inApp] = await notice(tm.id, userId);
    assert(inApp?.message.includes(SENTENCE) && !inApp.message.includes('fee') && !/R\d/.test(inApp.message),`The away team was told about money it didn't pay: ${inApp?.message}`);
  }

  // 4. Team match ("Open to both") with individual players: they get their own R80 back.
  const home2 = await newTeam('home2');
  const open = await teamMatch(home2, 'OPEN');
  const individual = await world.user('individual');
  const individualBefore = await balance(individual.id);
  await repository.join(open.id, individual.id, { team: 'AWAY' }, key());
  await cancel.cancel(open.id, admin.id, { reason: 'Lightning warning' }, world.marker);
  assert(await balance(individual.id) === individualBefore, 'An individual player was not refunded.');
  const [individualNotice] = await notice(open.id, individual.id);
  assert(individualNotice?.message.includes('Your R80 has been refunded') && !individualNotice.message.includes(TEAM_SENTENCE), `Wrong individual notice: ${individualNotice?.message}`);

  // 5. Team match from its 30-minute check: refused (its fees are taken at T-30), nothing moves.
  const home3 = await newTeam('home3');
  const locked = await teamMatch(home3, 'TEAMS_ONLY');
  const goNoGoAt = (await prisma.match.findUniqueOrThrow({ where: { id: locked.id } })).goNoGoAt!;
  assert(await rejectsWith(() => cancel.cancel(locked.id, admin.id, { reason: 'Rain' }, world.marker, goNoGoAt), 'TEAM_MATCH_LOCKED'), 'A team match was cancelled from its T-30 check.');
  assert((await prisma.match.findUniqueOrThrow({ where: { id: locked.id } })).status !== 'CANCELLED', 'A refused team cancellation changed the match.');

  const issues = await world.ourIssues();
  assert(issues.length === 0, `Reconciliation issues: ${JSON.stringify(issues)}`);
  console.log('Admin match cancel smoke passed: quick match refunds once (also between T-30 and kick-off), audited reason kept from players, host/player/referee/team notices and emails with the fixed sentence, team fee returned only to teams that held money, individuals refunded, refused after kick-off and for team matches from T-30.');
}

try {
  await main();
} finally {
  await referee.cleanupJobs(world.matchIds);
  await world.cleanup();
  await referee.cleanup();
  await prisma.$disconnect();
}
