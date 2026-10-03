import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import type { CreateMatchInput } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { serializableTransaction } from '../src/database/transaction.js';
import { MatchesRepository, OtherSideRefusedError, OwnTeamConflictError } from '../src/modules/matches/matches.repository.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { TeamMatchesService } from '../src/modules/team-matches/team-matches.service.js';
import { unmatchedCancelDedupeKey } from '../src/modules/team-matches/team-match-jobs.js';
import { TeamWalletRepository } from '../src/modules/team-wallet/team-wallet.repository.js';
import { assert, rejectsWith, teamMatchWorld } from './team-match-fixtures.js';

/**
 * Gate 7 / TKT-707 on PostgreSQL (DEC-019 decisions B, C, N1, N2, N5): the other side of a team
 * match is taken instantly by whoever comes first. A team loading and a player joining at the same
 * moment, or two teams loading at once: exactly one wins, with no orphan payment or hold.
 */
const ROUNDS = 4;
const world = teamMatchWorld(`gate7-race-${randomUUID()}`);
const matches = new MatchesService();
const repository = new MatchesRepository();
const teamMatches = new TeamMatchesService();
const teamWallets = new TeamWalletRepository();
let homeIndex = 0;

async function homeTeam() {
  const owner = await world.user(`Home owner ${homeIndex}`);
  const team = await world.team(`home-${homeIndex++}`, owner.id);
  await world.contribute(team.id, owner.id, 100_000, `home-${team.id}`);
  return { owner, team };
}
async function publish(ownerId: string, teamId: string, otherSideMode: 'OPEN' | 'TEAMS_ONLY', subs = 1) {
  const input: CreateMatchInput = {
    managedFieldId: world.fieldId, name: `${world.marker}-m${world.matchIds.length}`, format: 'FIVE_A_SIDE',
    substituteCapacityPerTeam: subs, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC',
    startsAt: world.nextKickoff().toISOString(), playAsTeamId: teamId, otherSideMode, teamSubstituteCount: subs,
  };
  const match = await matches.create(input, ownerId);
  world.matchIds.push(match.id);
  return match;
}
const side = (matchId: string) => prisma.match.findUniqueOrThrow({
  where: { id: matchId },
  select: {
    otherSideTakenBy: true,
    teamSides: { where: { side: 'AWAY' }, select: { teamId: true, substituteCount: true, teamFeeCents: true, id: true } },
    participants: { where: { status: 'JOINED' }, select: { userId: true } },
    payments: { select: { userId: true, status: true } },
  },
});

async function main() {
  await world.venue();
  const awayA = await world.user('Away A owner');
  const awayB = await world.user('Away B owner');
  const awayMember = await world.user('Away A member');
  const teamA = await world.team('away-a', awayA.id, [{ userId: awayMember.id, role: 'MEMBER' }]);
  const teamB = await world.team('away-b', awayB.id);
  await world.contribute(teamA.id, awayA.id, 50_000, 'away-a');
  const players = [];
  for (let index = 0; index < ROUNDS + 3; index += 1) players.push(await world.user(`Player ${index}`));

  // 1. Team loading vs individual joining at the same moment: exactly one wins, every round.
  const winners = { team: 0, individual: 0 };
  for (let round = 0; round < ROUNDS; round += 1) {
    const home = await homeTeam();
    const match = await publish(home.owner.id, home.team.id, 'OPEN');
    const player = players[round]!;
    const before = (await prisma.walletAccount.findUniqueOrThrow({ where: { userId: player.id } })).balanceCents;
    // Alternate which request reaches the Match lock first so both outcomes are raced.
    const startLoad = () => teamMatches.loadTeam(match.id, awayA.id, { teamId: teamA.id, substituteCount: 2 });
    const startJoin = () => repository.join(match.id, player.id, { team: 'AWAY' }, `${world.marker}:join:${match.id}`);
    const [load, join] = round % 2 === 0
      ? await Promise.allSettled([startLoad(), startJoin()])
      : await Promise.allSettled([
          startJoin(),
          new Promise((resolve) => setTimeout(resolve, 25)).then(startLoad),
        ]).then(([joined, loaded]) => [loaded, joined] as const);
    const state = await side(match.id);
    const teamWon = load.status === 'fulfilled';
    assert(teamWon !== (join.status === 'fulfilled'), `Round ${round}: expected exactly one winner.`);
    if (teamWon) {
      winners.team += 1;
      assert(join.status === 'rejected' && join.reason instanceof OtherSideRefusedError, `Round ${round}: the losing join failed for the wrong reason.`);
      assert(state.otherSideTakenBy === 'TEAM' && state.teamSides.length === 1 && state.participants.length === 0 && state.payments.length === 0,
        `Round ${round}: a team won but an individual was left on the side or charged.`);
      assert((await prisma.walletAccount.findUniqueOrThrow({ where: { userId: player.id } })).balanceCents === before, `Round ${round}: the losing player was charged.`);
      await teamMatches.withdrawTeam(match.id, awayA.id);
    } else {
      winners.individual += 1;
      assert(load.status === 'rejected' && (load.reason as { code?: string }).code === 'OTHER_SIDE_TAKEN', `Round ${round}: the losing load failed for the wrong reason.`);
      assert(state.otherSideTakenBy === 'INDIVIDUALS' && state.teamSides.length === 0 && state.participants.length === 1,
        `Round ${round}: a player won but a team was attached.`);
    }
  }

  // 2. Two teams loading at once into a "Teams only" match: exactly one AWAY team.
  const duel = await homeTeam();
  const teamsOnly = await publish(duel.owner.id, duel.team.id, 'TEAMS_ONLY');
  const duelResults = await Promise.allSettled([
    teamMatches.loadTeam(teamsOnly.id, awayA.id, { teamId: teamA.id, substituteCount: 0 }),
    teamMatches.loadTeam(teamsOnly.id, awayB.id, { teamId: teamB.id, substituteCount: 3 }),
  ]);
  assert(duelResults.filter((result) => result.status === 'fulfilled').length === 1, 'Two teams took the same side.');
  let state = await side(teamsOnly.id);
  assert(state.teamSides.length === 1, 'The side does not have exactly one away team.');
  const loadedTeam = state.teamSides[0]!;
  assert(loadedTeam.teamFeeCents === (loadedTeam.teamId === teamA.id ? 40_000 : 64_000), 'The loading team\'s own fee snapshot is wrong.');
  const awayLineup = await prisma.teamMatchLineupSlot.findMany({ where: { matchTeamId: loadedTeam.id } });
  assert(awayLineup.length === 5 && awayLineup.every((slot) => Number(slot.positionY) <= 50), 'The away squad was not loaded onto the away half.');
  const homeNotices = await prisma.notification.count({ where: { userId: duel.owner.id, type: 'TEAM_MATCH_OPPONENT_FOUND' } });
  assert(homeNotices === 1, 'The home team was not told once that an opponent was found.');
  assert(await prisma.durableJob.count({ where: { type: 'TEAM_MATCH_EMAIL', dedupeKey: { startsWith: `team-match-email:OPPONENT_FOUND:${teamsOnly.id}` } } }) === 1,
    'The home owner did not get one "opponent found" email.');
  assert(await rejectsWith(() => repository.join(teamsOnly.id, players[ROUNDS]!.id, { team: 'AWAY' }, `${world.marker}:late`).catch((error) => {
    throw error instanceof OtherSideRefusedError ? Object.assign(error, { code: error.reason }) : error;
  }), 'TAKEN_BY_TEAM'), 'A player joined a side a team had taken.');

  // 3. N5: only the loading team withdraws, releasing its own held money; the side reopens.
  const loaderOwner = loadedTeam.teamId === teamA.id ? awayA : awayB;
  const otherOwner = loadedTeam.teamId === teamA.id ? awayB : awayA;
  const otherTeam = loadedTeam.teamId === teamA.id ? teamB : teamA;
  // (A withdrawing team's paid places get the credit-or-refund choice: smoke:team-tickets.)
  assert(await rejectsWith(() => teamMatches.withdrawTeam(teamsOnly.id, duel.owner.id), 'TEAM_FORBIDDEN'), 'The home owner withdrew the other team.');
  const withdrawn = await teamMatches.withdrawTeam(teamsOnly.id, loaderOwner.id);
  assert(withdrawn.withdrawn, 'The team did not withdraw.');
  assert(await rejectsWith(() => teamMatches.withdrawTeam(teamsOnly.id, loaderOwner.id), 'OTHER_SIDE_NOT_TEAM'), 'A team withdrew twice.');
  state = await side(teamsOnly.id);
  assert(state.otherSideTakenBy === null && state.teamSides.length === 0, 'The side did not reopen after the withdrawal.');
  assert(await prisma.durableJob.count({ where: { dedupeKey: { startsWith: `${unmatchedCancelDedupeKey(teamsOnly.id)}:` } } }) === 1,
    'The "Teams only" 24-hour rule was not re-armed after the withdrawal.');
  assert(await prisma.notification.count({ where: { userId: duel.owner.id, type: 'TEAM_MATCH_OPPONENT_WITHDRAWN' } }) === 1, 'The home team was not told about the withdrawal.');
  // Withdraw, then another team loads.
  await teamMatches.loadTeam(teamsOnly.id, otherOwner.id, { teamId: otherTeam.id, substituteCount: 1 });
  assert((await side(teamsOnly.id)).teamSides[0]?.teamId === otherTeam.id, 'Another team could not load after a withdrawal.');
  // Withdrawing from the 30-minute check is refused.
  await prisma.match.update({ where: { id: teamsOnly.id }, data: { goNoGoAt: new Date(Date.now() - 1_000) } });
  assert(await rejectsWith(() => teamMatches.withdrawTeam(teamsOnly.id, otherOwner.id), 'LINEUP_LOCKED'), 'A team withdrew at or after T-30.');
  assert(await rejectsWith(() => teamMatches.loadTeam(teamsOnly.id, awayA.id, { teamId: teamA.id, substituteCount: 0 }), 'LINEUP_LOCKED'), 'A team loaded at T-30.');

  // 4. "Open to both": withdraw, then individuals join. N1: an emptied individuals side reopens to teams.
  const open = await homeTeam();
  const openMatch = await publish(open.owner.id, open.team.id, 'OPEN');
  await teamMatches.loadTeam(openMatch.id, awayA.id, { teamId: teamA.id, substituteCount: 0 });
  await teamMatches.withdrawTeam(openMatch.id, awayA.id);
  const individual = players[ROUNDS + 1]!;
  await repository.join(openMatch.id, individual.id, { team: 'AWAY' }, `${world.marker}:open-join`);
  assert((await side(openMatch.id)).otherSideTakenBy === 'INDIVIDUALS', 'Players could not join after a team withdrew.');
  assert(await rejectsWith(() => teamMatches.loadTeam(openMatch.id, awayB.id, { teamId: teamB.id, substituteCount: 0 }), 'OTHER_SIDE_TAKEN'),
    'A team loaded into a side players had joined.');
  await repository.cancelParticipation(openMatch.id, individual.id, new Date());
  await teamMatches.loadTeam(openMatch.id, awayB.id, { teamId: teamB.id, substituteCount: 0 });
  assert((await side(openMatch.id)).otherSideTakenBy === 'TEAM', 'An emptied individuals side did not reopen to teams (N1).');

  // 5. N2: nobody plays against their own team; players never join the home side.
  const own = await homeTeam();
  const ownMatch = await publish(own.owner.id, own.team.id, 'OPEN');
  assert(await repository.join(ownMatch.id, own.owner.id, { team: 'AWAY' }, `${world.marker}:own`).then(() => false, (error) => error instanceof OwnTeamConflictError),
    'A home team member joined the other side.');
  assert(await repository.join(ownMatch.id, players[ROUNDS + 2]!.id, { team: 'HOME' }, `${world.marker}:home`).then(() => false, (error) => error instanceof OtherSideRefusedError && error.reason === 'HOME_IS_A_TEAM'),
    'A player joined the home team\'s side.');
  await prisma.teamMembership.create({ data: { teamId: own.team.id, userId: awayMember.id, role: 'MEMBER' } });
  assert(await rejectsWith(() => teamMatches.loadTeam(ownMatch.id, awayA.id, { teamId: teamA.id, substituteCount: 0 }), 'OWN_TEAM_CONFLICT'),
    'A team with a home-team player loaded into the other side.');
  assert(await rejectsWith(() => teamMatches.loadTeam(ownMatch.id, awayMember.id, { teamId: teamA.id, substituteCount: 0 }), 'TEAM_FORBIDDEN'),
    'A plain member loaded their team.');

  const audit = await prisma.teamMatchAuditEvent.count({ where: { matchId: teamsOnly.id, command: { in: ['OTHER_SIDE_TEAM_LOADED', 'OTHER_SIDE_TEAM_WITHDRAWN'] } } });
  assert(audit === 3, `Side changes were not all audited (${audit}).`);
  const issues = await world.ourIssues();
  assert(issues.length === 0, `Reconciliation issues: ${JSON.stringify(issues)}`);
  console.log(`Gate 7 other-side race smoke passed (${ROUNDS} rounds: ${winners.team} team, ${winners.individual} individual; team-vs-team, N1, N2, N5).`);
}

try {
  await main();
} finally {
  await world.cleanup();
  await prisma.$disconnect();
}
