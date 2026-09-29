import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import type { CreateMatchInput } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { TeamsRepository } from '../src/modules/teams/teams.repository.js';
import { assert, rejectsWith, teamMatchWorld } from './team-match-fixtures.js';

/**
 * Gate 7 / TKT-704 on PostgreSQL: publishing a DEC-019 team match. Owner/captain only, always
 * public, managed venue slot reserved, HOME squad loaded, fee snapshot R80 x (starters + subs),
 * team-wallet AVAILABLE check (no money moves), at most two matches waiting for an opponent,
 * and no venue cost in any player-facing DTO.
 */
const world = teamMatchWorld(`gate7-setup-${randomUUID()}`);
const matches = new MatchesService();

const teamMatchInput = (teamId: string, overrides: Partial<CreateMatchInput> = {}): CreateMatchInput => ({
  managedFieldId: world.fieldId,
  name: `${world.marker}-match-${world.matchIds.length}`,
  format: 'FIVE_A_SIDE',
  substituteCapacityPerTeam: 5,
  rollingSubstitutes: false,
  rules: [],
  visibility: 'PUBLIC',
  startsAt: world.nextKickoff().toISOString(),
  playAsTeamId: teamId,
  otherSideMode: 'TEAMS_ONLY',
  teamSubstituteCount: 3,
  ...overrides,
});
const publish = async (input: CreateMatchInput, userId: string) => {
  const match = await matches.create(input, userId);
  world.matchIds.push(match.id);
  return match;
};

async function main() {
  const owner = await world.user('Home Owner');
  const captain = await world.user('Home Captain');
  const member = await world.user('Home Member');
  await world.venue();
  const home = await world.team('home', owner.id, [
    { userId: captain.id, role: 'CAPTAIN' },
    { userId: member.id, role: 'MEMBER' },
  ]);
  // The saved formation puts the owner in the first slot, so the HOME lineup must load them.
  const formation = await prisma.teamFormation.findUniqueOrThrow({ where: { teamId_format: { teamId: home.id, format: 'FIVE_A_SIDE' } }, include: { slots: true } });
  const ownerMembership = await prisma.teamMembership.findUniqueOrThrow({ where: { teamId_userId: { teamId: home.id, userId: owner.id } } });
  await prisma.teamFormationSlot.update({ where: { id: [...formation.slots].sort((a, b) => a.slotIndex - b.slotIndex)[0]!.id }, data: { membershipId: ownerMembership.id } });

  // D12: available team money must cover the fee (5 players + 3 subs = R640). No money moves.
  await world.contribute(home.id, owner.id, 50_000, 'c1');
  const shortfall = await publish(teamMatchInput(home.id), owner.id).then(() => null, (error: { code?: string; message: string }) => error);
  assert(shortfall?.code === 'TEAM_WALLET_TOP_UP_REQUIRED', 'A team match was published without enough available team money.');
  assert(shortfall.message === 'Top up your team wallet to at least R640 to publish this match.', `Wrong top-up message: ${shortfall.message}`);
  await world.contribute(home.id, member.id, 20_000, 'c2');
  const first = await publish(teamMatchInput(home.id), owner.id);
  assert(first.mode === 'TEAM_MATCH' && first.visibility === 'PUBLIC' && first.status === 'OPEN', 'A team match was not published as a public open match.');
  assert(first.otherSideMode === 'TEAMS_ONLY' && first.otherSideTakenBy === null && first.goNoGoAt, 'Team match side facts or go/no-go time missing.');
  assert(first.publicSlug, 'A public team match has no public slug.');
  const homeSide = first.teamSides.find((side) => side.side === 'HOME');
  assert(homeSide?.starterCount === 5 && homeSide.substituteCount === 3 && homeSide.teamFeeCents === 64_000, 'The HOME fee snapshot is not R80 x (5 + 3).');
  assert(first.substituteCapacityPerTeam === 3, 'The other side\'s sub places do not follow the home team (N4).');
  const reservation = await prisma.fieldReservation.findUniqueOrThrow({ where: { matchId: first.id } });
  assert(reservation.status === 'CONFIRMED' && reservation.priceCentsSnapshot === 50_000, 'The venue slot was not reserved with its admin-only cost.');
  const lineup = await prisma.teamMatchLineupSlot.findMany({ where: { matchTeamId: homeSide.id }, include: { selection: true } });
  assert(lineup.length === 5 && lineup.some((slot) => slot.selection?.userId === owner.id), 'The saved HOME squad was not loaded.');
  const wallet = await prisma.teamWalletAccount.findUniqueOrThrow({ where: { teamId: home.id }, include: { holds: true } });
  assert(wallet.balanceCents === 70_000 && wallet.holds.length === 0, 'Publishing moved or held team money.');
  const json = JSON.stringify(first);
  assert(!/price|50000|100000|priceCentsSnapshot/i.test(json), 'The team match DTO exposed a venue cost.');

  // Only owners and captains may publish; the same slot cannot be booked twice.
  assert(await rejectsWith(() => publish(teamMatchInput(home.id), member.id), 'TEAM_FORBIDDEN'), 'A member published a team match.');
  assert(await rejectsWith(() => publish(teamMatchInput(home.id, { startsAt: first.startsAt }), captain.id), 'FIELD_TIME_CONFLICT'), 'A second team match took a reserved slot.');

  // A captain publishes an "Open to both" match; a third waiting match is refused (D12).
  const second = await publish(teamMatchInput(home.id, { otherSideMode: 'OPEN', teamSubstituteCount: 0 }), captain.id);
  assert(second.otherSideMode === 'OPEN' && second.teamSides[0]?.teamFeeCents === 40_000, 'The "Open to both" fee snapshot is wrong.');
  assert(await rejectsWith(() => publish(teamMatchInput(home.id), owner.id), 'TEAM_MATCHES_AWAITING_OPPONENT_LIMIT'),
    'A third team match waiting for an opponent was published.');

  // Team matches are listed in the lobby alongside Quick Matches.
  const listed = await matches.list({ limit: 200, availableOnly: false } as never);
  assert(listed.some((match) => match.id === first.id) && listed.some((match) => match.id === second.id), 'Team matches are missing from the lobby list.');

  // A closed team cannot publish.
  const other = await world.team('closed', owner.id);
  await new TeamsRepository().close(other.id, owner.id);
  assert(await rejectsWith(() => publish(teamMatchInput(other.id), owner.id), 'TEAM_ARCHIVED'), 'A closed team published a match.');

  assert((await world.ourIssues()).length === 0, `Reconciliation issues: ${JSON.stringify(await world.ourIssues())}`);
  console.log('Gate 7 team-match setup smoke passed (TKT-704).');
}

try {
  await main();
} finally {
  await world.cleanup();
  await prisma.$disconnect();
}
