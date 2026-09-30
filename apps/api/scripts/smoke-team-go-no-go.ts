import './assert-disposable-test-database.js';
import { refereeFixture } from './referee-fixture.js';
import { randomUUID } from 'node:crypto';
import type { CreateMatchInput } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { runOneDurableJob } from '../src/jobs/durable-jobs.js';
import { TestEmailProvider } from '../src/modules/auth/email.provider.js';
import { registerMatchCancelledEmailJobHandlers } from '../src/modules/matches/match-cancelled-email.jobs.js';
import { transitionMatchToStarted } from '../src/modules/matches/match-lifecycle.scheduler.js';
import { MatchesRepository } from '../src/modules/matches/matches.repository.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { registerTeamMatchJobHandlers } from '../src/modules/team-matches/team-match.jobs.js';
import { TeamMatchMetersService, teamGoNoGoDedupeKey } from '../src/modules/team-matches/team-match-meters.js';
import { TeamMatchesService } from '../src/modules/team-matches/team-matches.service.js';
import { assert, rejectsWith, teamMatchWorld } from './team-match-fixtures.js';

/**
 * Gate 7 / TKT-709 on PostgreSQL (DEC-019 with D1-D5, D11, N4): team fees, fill meters and the
 * team T-30 go/no-go. Every path is checked for money moving exactly once: GO captures each
 * held rand once, NO-GO releases every hold and refunds every individual once, and a confirmed
 * match owes its venue at kickoff from the admin-only price snapshot.
 */
const world = teamMatchWorld(`gate7-gonogo-${randomUUID()}`);
// Gate 8: a match also needs an active referee to be confirmed at T-30 (DEC-020).
const referee = refereeFixture(`ref-${world.marker}`);
const matches = new MatchesService();
const repository = new MatchesRepository();
const teamMatches = new TeamMatchesService();
const meters = new TeamMatchMetersService();
const emails = new TestEmailProvider();
let keyIndex = 0;
const key = () => `${world.marker}:k${keyIndex++}`;

const teamBalance = async (teamId: string) => (await prisma.teamWalletAccount.findUniqueOrThrow({ where: { teamId } })).balanceCents;
const personalBalance = async (userId: string) => (await prisma.walletAccount.findUniqueOrThrow({ where: { userId } })).balanceCents;
const activeHolds = (matchId: string) => prisma.teamWalletHold.count({ where: { matchId, status: 'ACTIVE' } });

async function newTeam(label: string, fundCents = 100_000) {
  const owner = await world.user(`${label} owner`, Math.max(200_000, fundCents));
  const captain = await world.user(`${label} captain`);
  const member = await world.user(`${label} member`);
  const team = await world.team(label, owner.id, [{ userId: captain.id, role: 'CAPTAIN' }, { userId: member.id, role: 'MEMBER' }]);
  await world.contribute(team.id, owner.id, fundCents, `${label}-fund`);
  return { owner, captain, member, team };
}
async function publish(home: Awaited<ReturnType<typeof newTeam>>, otherSideMode: 'OPEN' | 'TEAMS_ONLY', subs: number) {
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
/** Pretend the clock has reached T-30 for a match still in the future. */
async function reachT30(matchId: string) {
  const past = new Date(Date.now() - 1_000);
  await prisma.match.update({ where: { id: matchId }, data: { goNoGoAt: past } });
  await prisma.durableJob.update({ where: { dedupeKey: teamGoNoGoDedupeKey(matchId) }, data: { runAt: past } });
}
async function runQueuedGoNoGo(matchId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const job = await prisma.durableJob.findUniqueOrThrow({ where: { dedupeKey: teamGoNoGoDedupeKey(matchId) } });
    if (job.status === 'SUCCEEDED') return job;
    if (!(await runOneDurableJob())) break;
  }
  return prisma.durableJob.findUniqueOrThrow({ where: { dedupeKey: teamGoNoGoDedupeKey(matchId) } });
}
async function joinAndClaim(matchId: string, players: Array<{ id: string }>, claim: number) {
  const slots = await prisma.formationSlot.findMany({ where: { matchId, team: 'AWAY' }, orderBy: { slotIndex: 'asc' } });
  for (const [index, player] of players.entries()) {
    await repository.join(matchId, player.id, { team: 'AWAY' }, `${world.marker}:join:${matchId}:${player.id}`);
    if (index < claim) await repository.claimPosition(matchId, slots[index]!.id, player.id);
  }
}

async function main() {
  registerTeamMatchJobHandlers(undefined, emails);
  registerMatchCancelledEmailJobHandlers(emails);
  await world.venue();
  const players = [];
  for (let index = 0; index < 12; index += 1) players.push(await world.user(`Player ${index}`));

  // 1. "Teams only", both meters full: GO. Each rand captured once; the venue is owed at kickoff.
  const homeA = await newTeam('home-a');
  const away = await newTeam('away', 300_000);
  const goMatch = await publish(homeA, 'TEAMS_ONLY', 1); // R400 + R80 = R480
  const before = await meters.meter(goMatch.id, 'HOME', homeA.member.id);
  assert(!before.active && before.feeCents === 48_000 && before.heldCents === 0, 'The home meter was active before an opponent was found.');
  assert(await rejectsWith(() => meters.fill(goMatch.id, 'HOME', homeA.captain.id, undefined, key()), 'TEAM_METER_NOT_ACTIVE'), 'A meter filled before the other side was taken.');
  await teamMatches.loadTeam(goMatch.id, away.owner.id, { teamId: away.team.id, substituteCount: 0 }); // R400
  assert(await rejectsWith(() => meters.fill(goMatch.id, 'HOME', homeA.member.id, undefined, key()), 'TEAM_FORBIDDEN'), 'A plain member filled the meter.');
  assert(await rejectsWith(() => meters.meter(goMatch.id, 'HOME', away.owner.id), 'TEAM_FORBIDDEN'), 'A team saw the other team\'s meter.');
  const partialKey = key();
  await meters.fill(goMatch.id, 'HOME', homeA.captain.id, 20_000, partialKey);
  const replay = await meters.fill(goMatch.id, 'HOME', homeA.captain.id, 20_000, partialKey);
  assert(replay.replayed && replay.view.heldCents === 20_000, 'A replayed fill held money twice.');
  assert(await rejectsWith(() => meters.fill(goMatch.id, 'HOME', homeA.captain.id, 30_000, key()), 'TEAM_METER_OVERFILL'), 'The meter was over-filled.');
  const filled = await meters.fill(goMatch.id, 'HOME', homeA.owner.id, undefined, key());
  assert(filled.view.full && filled.view.heldCents === 48_000 && filled.view.teamWalletAvailableCents === 52_000, 'Filling the rest did not make the home meter "R480 / R480".');
  assert(await rejectsWith(() => meters.fill(goMatch.id, 'HOME', homeA.owner.id, undefined, key()), 'TEAM_METER_FULL'), 'A full meter accepted more money.');
  // DEC-019: venue costs never reach teams; the admin-only price here is R500 (50000 cents).
  assert(!/price|venue|payable|50000|Snapshot/i.test(JSON.stringify(filled.view)), 'The team meter DTO exposed a venue cost.');
  assert(await teamBalance(homeA.team.id) === 100_000, 'Filling the meter moved team money instead of holding it.');
  await meters.fill(goMatch.id, 'AWAY', away.captain.id, undefined, key());
  await reachT30(goMatch.id);
  assert(await rejectsWith(() => meters.fill(goMatch.id, 'HOME', homeA.captain.id, 100, key()), 'LINEUP_LOCKED'), 'A meter changed after T-30.');
  assert(await rejectsWith(() => meters.changeSubstitutes(goMatch.id, 'HOME', homeA.owner.id, 2), 'LINEUP_LOCKED'), 'Subs changed after T-30.');
  const job = await runQueuedGoNoGo(goMatch.id);
  assert(job.status === 'SUCCEEDED', 'The durable team go/no-go job did not succeed.');
  assert((await meters.decideGoNoGo(goMatch.id)).outcome === 'ALREADY_DECIDED', 'A second decision was not a no-op.');
  const confirmed = await prisma.match.findUniqueOrThrow({ where: { id: goMatch.id } });
  assert(confirmed.confirmedAt && confirmed.status !== 'CANCELLED', 'Both full meters did not confirm the match.');
  assert(await teamBalance(homeA.team.id) === 52_000 && await teamBalance(away.team.id) === 260_000, 'Each team was not charged exactly its own fee once.');
  assert(await prisma.teamWalletHold.count({ where: { matchId: goMatch.id, status: 'CAPTURED' } }) === 3 && await activeHolds(goMatch.id) === 0, 'Not every hold was captured.');
  assert(await prisma.notification.count({ where: { type: 'MATCH_CONFIRMED', targetPath: `/matches/${goMatch.id}` } }) === 6, 'Both teams\' members were not told once that the match goes ahead.');
  await prisma.match.update({ where: { id: goMatch.id }, data: { goNoGoAt: new Date(Date.now() - 3_600_000), startsAt: new Date(Date.now() - 60_000) } });
  assert(await transitionMatchToStarted(goMatch.id), 'A confirmed team match did not kick off.');
  const payable = await prisma.venuePayable.findUniqueOrThrow({ where: { matchId: goMatch.id } });
  const reservation = await prisma.fieldReservation.findUniqueOrThrow({ where: { matchId: goMatch.id } });
  assert(payable.amountCents === reservation.priceCentsSnapshot && payable.amountCents === 50_000, 'The venue payable is not the admin-only price snapshot.');

  // 1b. Gate 8 (DEC-020, D2, D23): both meters full but no active referee at T-30: NO-GO with
  // reason NO_REFEREE. Every hold is released once and nothing is charged.
  const homeR = await newTeam('home-r');
  const awayR = await newTeam('away-r', 300_000);
  const refMatch = await publish(homeR, 'TEAMS_ONLY', 0);
  await teamMatches.loadTeam(refMatch.id, awayR.owner.id, { teamId: awayR.team.id, substituteCount: 0 });
  await meters.fill(refMatch.id, 'HOME', homeR.owner.id, undefined, key());
  await meters.fill(refMatch.id, 'AWAY', awayR.owner.id, undefined, key());
  await prisma.match.update({ where: { id: refMatch.id }, data: { refereeUserId: null, refereeAssignedAt: null } });
  await reachT30(refMatch.id);
  const refDecision = await meters.decideGoNoGo(refMatch.id);
  assert(refDecision.outcome === 'CANCELLED', 'A team match with no referee went ahead.');
  assert((await prisma.match.findUniqueOrThrow({ where: { id: refMatch.id } })).cancellationReason === 'NO_REFEREE', 'The team no-go did not give NO_REFEREE.');
  assert(await activeHolds(refMatch.id) === 0 && await prisma.teamWalletHold.count({ where: { matchId: refMatch.id, status: 'CAPTURED' } }) === 0, 'Team money was captured without a referee.');
  assert(await teamBalance(homeR.team.id) === 100_000 && await teamBalance(awayR.team.id) === 300_000, 'A team was charged for a match with no referee.');

  // 2. "Teams only", away meter short: NO-GO. Every hold released once, nothing charged or owed.
  const homeB = await newTeam('home-b');
  const shortMatch = await publish(homeB, 'TEAMS_ONLY', 0);
  await teamMatches.loadTeam(shortMatch.id, away.owner.id, { teamId: away.team.id, substituteCount: 0 });
  await meters.fill(shortMatch.id, 'HOME', homeB.owner.id, undefined, key());
  await meters.fill(shortMatch.id, 'AWAY', away.owner.id, 10_000, key());
  const awayBefore = await teamBalance(away.team.id);
  await reachT30(shortMatch.id);
  const noGo = await meters.decideGoNoGo(shortMatch.id);
  await meters.decideGoNoGo(shortMatch.id);
  const shortState = await prisma.match.findUniqueOrThrow({ where: { id: shortMatch.id }, include: { fieldReservation: true, venuePayable: true } });
  assert(noGo.outcome === 'CANCELLED' && shortState.cancellationReason === 'TEAM_FEES_UNFUNDED', 'An unfunded team match was not cancelled for that reason.');
  assert(await activeHolds(shortMatch.id) === 0 && await prisma.teamWalletHold.count({ where: { matchId: shortMatch.id, status: 'CAPTURED' } }) === 0, 'A no-go left money held or captured.');
  assert(await teamBalance(homeB.team.id) === 100_000 && await teamBalance(away.team.id) === awayBefore, 'A no-go charged a team.');
  assert(shortState.fieldReservation?.status === 'CANCELLED' && !shortState.venuePayable, 'A cancelled team match owes the venue.');
  const cancelNotices = await prisma.notification.findMany({ where: { type: 'MATCH_CANCELLED', targetPath: `/matches/${shortMatch.id}` } });
  assert(cancelNotices.length === 6 && cancelNotices.every(({ message }) => message.includes('gone back to your team wallet')), 'Both teams were not told once, with the release sentence.');
  assert(await prisma.durableJob.count({ where: { type: 'MATCH_CANCELLED_EMAIL', dedupeKey: { contains: shortMatch.id } } }) === 6, 'Cancellation emails were not queued once per member.');

  // 3. "Open to both", players on every away position: GO. Home fee captured; players' R80 stays paid.
  const homeC = await newTeam('home-c');
  const openGo = await publish(homeC, 'OPEN', 0);
  await joinAndClaim(openGo.id, players.slice(0, 5), 5);
  await meters.fill(openGo.id, 'HOME', homeC.captain.id, undefined, key());
  await reachT30(openGo.id);
  assert((await meters.decideGoNoGo(openGo.id)).outcome === 'CONFIRMED', 'Full home meter plus every position claimed did not confirm the match.');
  assert(await teamBalance(homeC.team.id) === 60_000, 'The home fee was not captured once.');
  assert(await prisma.matchPayment.count({ where: { matchId: openGo.id, status: 'SUCCEEDED' } }) === 5, 'Players\' R80 were not kept on a confirmed match.');

  // 4. "Open to both", an away position empty: NO-GO. Every player refunded once, home released.
  const homeD = await newTeam('home-d');
  const openShort = await publish(homeD, 'OPEN', 0);
  const shortPlayers = players.slice(5, 8);
  await joinAndClaim(openShort.id, shortPlayers, 3);
  const playerBefore = await Promise.all(shortPlayers.map(({ id }) => personalBalance(id)));
  await meters.fill(openShort.id, 'HOME', homeD.owner.id, undefined, key());
  await reachT30(openShort.id);
  assert((await meters.decideGoNoGo(openShort.id)).outcome === 'CANCELLED', 'An open match with empty positions went ahead.');
  await meters.decideGoNoGo(openShort.id);
  assert((await prisma.match.findUniqueOrThrow({ where: { id: openShort.id } })).cancellationReason === 'POSITIONS_UNFILLED', 'The individuals no-go reason is wrong.');
  const playerAfter = await Promise.all(shortPlayers.map(({ id }) => personalBalance(id)));
  assert(playerAfter.every((balance, index) => balance === playerBefore[index]! + 8_000), 'Every player was not refunded R80 exactly once.');
  assert(await teamBalance(homeD.team.id) === 100_000 && await activeHolds(openShort.id) === 0, 'The home meter was not released.');

  // 5. Nobody took the other side: NO-GO, nothing held or owed.
  const homeE = await newTeam('home-e');
  const lonely = await publish(homeE, 'OPEN', 0);
  await reachT30(lonely.id);
  // A worker that crashed mid-run leaves the job RUNNING; the queue reclaims it and decides once.
  await prisma.durableJob.update({ where: { dedupeKey: teamGoNoGoDedupeKey(lonely.id) }, data: { status: 'RUNNING', lockedAt: new Date(Date.now() - 86_400_000), attempts: 1 } });
  assert((await runQueuedGoNoGo(lonely.id)).status === 'SUCCEEDED', 'A stale team go/no-go job was not reclaimed.');
  assert((await prisma.match.findUniqueOrThrow({ where: { id: lonely.id } })).cancellationReason === 'NO_OPPONENT', 'A match with no opponent was not cancelled at T-30.');

  // 6. D5 / N4: changing subs recalculates the fee and releases any excess at once; the home team
  // cannot go below the subs who already joined the individuals side.
  const homeF = await newTeam('home-f');
  const subsMatch = await publish(homeF, 'OPEN', 2); // R400 + R160 = R560
  const joiners = [...players.slice(8, 12)];
  for (let index = 0; index < 3; index += 1) joiners.push(await world.user(`Joiner ${index}`));
  await joinAndClaim(subsMatch.id, joiners, 0); // 7 players = 5 starters + 2 subs
  assert(await rejectsWith(() => meters.changeSubstitutes(subsMatch.id, 'HOME', homeF.owner.id, 1), 'SUBSTITUTES_BELOW_JOINED'), 'The home subs dropped below the subs who joined (N4).');
  const raised = await meters.changeSubstitutes(subsMatch.id, 'HOME', homeF.owner.id, 3);
  assert(raised.view.feeCents === 64_000 && (await prisma.match.findUniqueOrThrow({ where: { id: subsMatch.id } })).substituteCapacityPerTeam === 3,
    'Raising subs did not update the fee and the individuals side capacity.');
  await meters.fill(subsMatch.id, 'HOME', homeF.owner.id, 30_000, key());
  await meters.fill(subsMatch.id, 'HOME', homeF.owner.id, undefined, key()); // R340 more
  const lowered = await meters.changeSubstitutes(subsMatch.id, 'HOME', homeF.owner.id, 2);
  assert(lowered.releasedCents === 8_000 && lowered.view.feeCents === 56_000 && lowered.view.heldCents === 56_000 && lowered.view.full,
    'Lowering subs did not release exactly the excess.');
  const reheld = await prisma.teamWalletHold.findMany({ where: { matchId: subsMatch.id, status: 'ACTIVE' }, orderBy: { amountCents: 'asc' } });
  assert(reheld.map(({ amountCents }) => amountCents).join(',') === '26000,30000', 'The partly released hold was not re-held for the rest.');
  assert(await rejectsWith(() => meters.changeSubstitutes(subsMatch.id, 'HOME', homeF.member.id, 3), 'TEAM_FORBIDDEN'), 'A member changed the subs.');

  // 7. Home cancel before T-30, then T-30: released once, no second decision.
  const homeG = await newTeam('home-g');
  const cancelMatch = await publish(homeG, 'TEAMS_ONLY', 0);
  await teamMatches.loadTeam(cancelMatch.id, away.owner.id, { teamId: away.team.id, substituteCount: 0 });
  await meters.fill(cancelMatch.id, 'HOME', homeG.owner.id, undefined, key());
  await meters.fill(cancelMatch.id, 'AWAY', away.owner.id, undefined, key());
  await matches.remove(cancelMatch.id, homeG.captain.id);
  await reachT30(cancelMatch.id);
  assert((await meters.decideGoNoGo(cancelMatch.id)).outcome === 'ALREADY_DECIDED', 'T-30 ran again after a home cancel.');
  assert(await activeHolds(cancelMatch.id) === 0 && await prisma.teamWalletHold.count({ where: { matchId: cancelMatch.id, status: 'CAPTURED' } }) === 0, 'A cancelled match kept or captured money.');

  // 8. Last fill racing the T-30 check: either the fill landed first (GO) or it was refused (NO-GO).
  const raceOutcomes = { confirmed: 0, cancelled: 0 };
  for (let round = 0; round < 3; round += 1) {
    const home = await newTeam(`race-${round}`);
    const raceMatch = await publish(home, 'TEAMS_ONLY', 0);
    await teamMatches.loadTeam(raceMatch.id, away.owner.id, { teamId: away.team.id, substituteCount: 0 });
    await meters.fill(raceMatch.id, 'AWAY', away.owner.id, undefined, key());
    await meters.fill(raceMatch.id, 'HOME', home.owner.id, 20_000, key());
    const goNoGoAt = new Date(Date.now() + 150);
    await prisma.match.update({ where: { id: raceMatch.id }, data: { goNoGoAt } });
    const [fill] = await Promise.allSettled([
      new Promise((resolve) => setTimeout(resolve, round * 100)).then(() => meters.fill(raceMatch.id, 'HOME', home.owner.id, undefined, key())),
      new Promise((resolve) => setTimeout(resolve, 200)).then(() => meters.decideGoNoGo(raceMatch.id, new Date())),
    ]);
    const decided = await prisma.match.findUniqueOrThrow({ where: { id: raceMatch.id } });
    const captured = await prisma.teamWalletHold.count({ where: { matchId: raceMatch.id, status: 'CAPTURED' } });
    if (decided.confirmedAt) {
      raceOutcomes.confirmed += 1;
      assert(fill.status === 'fulfilled' && await activeHolds(raceMatch.id) === 0 && captured >= 3, `Race ${round}: confirmed without every hold captured.`);
    } else {
      raceOutcomes.cancelled += 1;
      assert(decided.status === 'CANCELLED' && captured === 0 && await activeHolds(raceMatch.id) === 0, `Race ${round}: cancelled but money is held or captured.`);
    }
  }

  // 9. The 2-hour reminder reaches only the managers of a side whose meter is short, once.
  const homeH = await newTeam('home-h');
  const remindMatch = await publish(homeH, 'TEAMS_ONLY', 0);
  await teamMatches.loadTeam(remindMatch.id, away.owner.id, { teamId: away.team.id, substituteCount: 0 });
  await meters.fill(remindMatch.id, 'AWAY', away.owner.id, undefined, key());
  const reminders = await meters.remindUnfilledMeters(remindMatch.id);
  await meters.remindUnfilledMeters(remindMatch.id);
  assert(reminders.length === 2 && reminders.every(({ userId }) => [homeH.owner.id, homeH.captain.id].includes(userId)), 'The meter reminder did not go only to the short side\'s managers.');

  const issues = await world.ourIssues();
  assert(issues.length === 0, `Reconciliation issues: ${JSON.stringify(issues)}`);
  console.log(`Gate 7 team go/no-go smoke passed (fill/T-30 race: ${raceOutcomes.confirmed} confirmed, ${raceOutcomes.cancelled} cancelled).`);
}

try {
  await main();
} finally {
  await world.cleanup();
  await referee.cleanup();
  await prisma.$disconnect();
}
