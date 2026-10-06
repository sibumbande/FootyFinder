import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import type { CreateMatchInput } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { MatchLineupService } from '../src/modules/match-lineup/match-lineup.service.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { findRefereeClash } from '../src/modules/referees/referee-assignment.js';
import { TeamMatchesService } from '../src/modules/team-matches/team-matches.service.js';
import { refereeFixture } from './referee-fixture.js';
import { assert, rejectsWith, teamMatchWorld } from './team-match-fixtures.js';
import { buyTicket } from './support/ticket-fixtures.js';

/**
 * Gate 9 / TKT-908 on PostgreSQL: a player cannot join a match, be selected in a team lineup or be
 * loaded with a team into a match whose window (kickoff to scheduled end + 30 min) overlaps
 * another match they are in, as a player or referee. Refereeing the match you play in stays allowed.
 * Two venues let two matches take place at overlapping times.
 */
const a = teamMatchWorld(`gate9-overlap-a-${randomUUID()}`);
const b = teamMatchWorld(`gate9-overlap-b-${randomUUID()}`);
const referee = refereeFixture(`ref-${a.marker}`);
const matches = new MatchesService();
const teamMatches = new TeamMatchesService();
const lineups = new MatchLineupService();
let n = 0;
const key = () => `${a.marker}:k${n++}`;
const MIN = 60_000;

const quick = async (world: typeof a, hostId: string, startsAt: Date, extra: Partial<CreateMatchInput> = {}) => {
  const match = await matches.create({
    managedFieldId: world.fieldId, name: `${world.marker}-m${n++}`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 2,
    rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: startsAt.toISOString(), ...extra,
  } as CreateMatchInput, hostId);
  world.matchIds.push(match.id);
  return match;
};

async function main() {
  await a.venue();
  await b.venue();
  const kickoff = a.nextKickoff();
  b.nextKickoff();
  const [host, player, other] = [await a.user('Host'), await a.user('Player'), await a.user('Other')];

  // Quick matches: 14:00 on venue A; 14:30 on venue B overlaps; 15:30 (venue A again) only touches the window.
  const q1 = await quick(a, host.id, kickoff);
  const q2 = await quick(b, host.id, new Date(kickoff.getTime() + 30 * MIN));
  const q3 = await quick(a, host.id, new Date(kickoff.getTime() + 90 * MIN));
  await buyTicket(q1.id, player.id, 'HOME', key());
  await rejectsWith(() => buyTicket(q2.id, player.id, 'HOME', key()), 'PLAYER_MATCH_OVERLAP');
  assert(!(await prisma.matchParticipant.findFirst({ where: { matchId: q2.id, userId: player.id } })), 'The overlapping join left a participant.');
  // DEC-021: the refusal comes before any payment, so the player holds one ticket (q1) and nothing on q2.
  assert((await prisma.matchTicket.count({ where: { playerId: player.id, status: { in: ['HELD', 'CONFIRMED'] } } })) === 1, 'The refused join still charged the player.');
  assert(!(await prisma.ticketCheckout.count({ where: { matchId: q2.id, payerId: player.id } })), 'The refused join opened a checkout.');
  await buyTicket(q3.id, player.id, 'HOME', key());

  // Refereeing counts both ways, but playing in the match you referee is allowed (D17).
  const refId = await referee.create();
  await referee.assign(q2.id);
  await rejectsWith(() => buyTicket(q1.id, refId, 'AWAY', key()), 'PLAYER_MATCH_OVERLAP');
  const timing = async (id: string) => prisma.match.findUniqueOrThrow({ where: { id }, select: { id: true, startsAt: true, durationMinutes: true } });
  assert(await findRefereeClash(prisma, refId, await timing(q1.id)), 'A referee could be given a match overlapping one they referee.');
  await prisma.refereeGrant.create({ data: { userId: other.id, grantReason: 'Gate 9 smoke' } });
  await buyTicket(q1.id, other.id, 'AWAY', key());
  // D17b: a referee cannot referee a match overlapping one they play in; D17: their own match is fine.
  assert(await findRefereeClash(prisma, other.id, await timing(q2.id)), 'A player could referee an overlapping match.');
  assert(!(await findRefereeClash(prisma, other.id, await timing(q1.id))), 'A player could not referee the match they play in.');

  // Team lineups: a member already in an overlapping match cannot be selected as a starter or sub.
  const owner = await a.user('Team Owner');
  const busy = player;
  const free = await a.user('Free member');
  const team = await a.team('overlap-fc', owner.id, [{ userId: busy.id, role: 'MEMBER' }, { userId: free.id, role: 'MEMBER' }]);
  const tm = await matches.create({
    managedFieldId: b.fieldId, name: `${a.marker}-team`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 2, rollingSubstitutes: false,
    rules: [], visibility: 'PUBLIC', startsAt: new Date(kickoff.getTime() + 20 * 60 * MIN).toISOString(), playAsTeamId: team.id, otherSideMode: 'OPEN', teamSubstituteCount: 1,
  } as CreateMatchInput, owner.id);
  a.matchIds.push(tm.id);
  // Make the team match overlap q1 for this check (fixture move; the lineup rule reads the match times).
  await prisma.match.update({ where: { id: tm.id }, data: { startsAt: new Date(kickoff.getTime() + 15 * MIN), goNoGoAt: new Date(kickoff.getTime() - 15 * MIN) } });
  const lineup = await lineups.get(tm.id, 'HOME', owner.id);
  lineup.slots.sort((x, y) => x.slotIndex - y.slotIndex);
  await rejectsWith(() => lineups.assignStarter(tm.id, 'HOME', lineup.slots[1]!.id, { userId: busy.id }, owner.id), 'PLAYER_MATCH_OVERLAP');
  await rejectsWith(() => lineups.selectSubstitute(tm.id, 'HOME', busy.id, owner.id), 'PLAYER_MATCH_OVERLAP');
  await lineups.assignStarter(tm.id, 'HOME', lineup.slots[1]!.id, { userId: free.id }, owner.id);

  // Loading a team: an overlapping member of the saved squad is left out and the captain is told.
  const awayOwner = await a.user('Away Owner');
  const awayBusy = await a.user('Away busy');
  await buyTicket(q1.id, awayBusy.id, 'AWAY', key());
  const away = await a.team('overlap-away', awayOwner.id, [{ userId: awayBusy.id, role: 'MEMBER' }]);
  const membership = await prisma.teamMembership.findUniqueOrThrow({ where: { teamId_userId: { teamId: away.id, userId: awayBusy.id } } });
  const formation = await prisma.teamFormation.findFirstOrThrow({ where: { teamId: away.id, format: 'FIVE_A_SIDE' }, include: { slots: { orderBy: { slotIndex: 'asc' } } } });
  await prisma.teamFormationSlot.update({ where: { id: formation.slots[1]!.id }, data: { membershipId: membership.id } });
  const homeOnly = await a.team('overlap-home', (await a.user('Home Owner')).id);
  const homeOwnerId = (await prisma.teamMembership.findFirstOrThrow({ where: { teamId: homeOnly.id, role: 'OWNER' } })).userId;
  const teamsOnly = await matches.create({
    managedFieldId: a.fieldId, name: `${a.marker}-teams-only`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 0, rollingSubstitutes: false,
    rules: [], visibility: 'PUBLIC', startsAt: new Date(kickoff.getTime() + 26 * 60 * MIN).toISOString(), playAsTeamId: homeOnly.id, otherSideMode: 'TEAMS_ONLY', teamSubstituteCount: 0,
  } as CreateMatchInput, homeOwnerId);
  a.matchIds.push(teamsOnly.id);
  await prisma.match.update({ where: { id: teamsOnly.id }, data: { startsAt: new Date(kickoff.getTime() + 45 * MIN), goNoGoAt: new Date(kickoff.getTime() + 15 * MIN) } });
  await teamMatches.loadTeam(teamsOnly.id, awayOwner.id, { teamId: away.id, substituteCount: 0 });
  const awaySide = await prisma.matchTeam.findFirstOrThrow({ where: { matchId: teamsOnly.id, side: 'AWAY' } });
  assert(!(await prisma.teamMatchSelection.findFirst({ where: { matchTeamId: awaySide.id, userId: awayBusy.id } })), 'An overlapping player was loaded with the team.');
  assert(await prisma.notification.count({ where: { userId: awayOwner.id, title: 'Some players were left out' } }) === 1, 'The captain was not told who was left out.');

  console.log('Match overlap smoke passed: overlapping join refused with no charge, touching windows allowed, refereeing counts both ways (not for your own match), lineup starter/sub selection refused, overlapping squad members left out when a team loads (captain told).');
}

try {
  await main();
} finally {
  const all = [...a.matchIds, ...b.matchIds];
  await referee.cleanupJobs(all);
  await prisma.matchRefereeAssignment.deleteMany({ where: { matchId: { in: all } } });
  await prisma.match.updateMany({ where: { id: { in: all } }, data: { refereeUserId: null, refereeAssignedAt: null } });
  await prisma.refereeGrant.deleteMany({ where: { user: { email: { startsWith: a.marker } } } });
  await prisma.matchPayment.deleteMany({ where: { matchId: { in: all } } });
  // One world removes every match first (the matches span both venues), then each removes its venue and users.
  a.matchIds.splice(0, a.matchIds.length, ...all);
  b.matchIds.splice(0, b.matchIds.length);
  for (const world of [a, b])
    await world.cleanup().catch((error: unknown) => {
      console.error('Cleanup failed:', error);
      process.exitCode = 1;
    });
  await referee.cleanup().catch(() => undefined);
  await prisma.$disconnect();
}
