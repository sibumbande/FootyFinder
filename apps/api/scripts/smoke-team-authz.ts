import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import type { CreateMatchInput } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { MatchAvailabilityService } from '../src/modules/match-availability/match-availability.service.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { TeamMatchesService } from '../src/modules/team-matches/team-matches.service.js';
import { TeamsRepository } from '../src/modules/teams/teams.repository.js';
import { assert, teamMatchWorld } from './team-match-fixtures.js';

/**
 * Gate 7 / TKT-708 on PostgreSQL: the side-scoped authorization matrix through the real services.
 * Actors: owner / captain / member of HOME and AWAY, an outsider, a platform admin, a demoted
 * captain and a removed member. Every refusal is 403 TEAM_FORBIDDEN (or the Quick Match host
 * code) and changes nothing.
 */
const world = teamMatchWorld(`gate7-authz-${randomUUID()}`);
const matches = new MatchesService();
const teamMatches = new TeamMatchesService();
const availability = new MatchAvailabilityService();

type Actor = { label: string; id: string };
const outcome = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return 'allowed';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
};
/** Refuses everyone not permitted; then runs the command as each permitted actor (or only `runAs`). */
async function expectMatrix(command: string, actors: Actor[], allowed: Set<string>, run: (actor: Actor) => Promise<unknown>, runAs?: string) {
  for (const actor of actors) {
    if (allowed.has(actor.label)) continue;
    const result = await outcome(() => run(actor));
    assert(result === 'TEAM_FORBIDDEN', `${command}: ${actor.label} should be refused with TEAM_FORBIDDEN, got ${result}.`);
  }
  for (const actor of actors.filter(({ label }) => allowed.has(label) && (!runAs || label === runAs))) {
    const result = await outcome(() => run(actor));
    assert(result === 'allowed', `${command}: ${actor.label} should be allowed, got ${result}.`);
  }
}

async function main() {
  await world.venue();
  const roles = ['home-owner', 'home-captain', 'home-member', 'away-owner', 'away-captain', 'away-member', 'outsider', 'admin', 'demoted', 'removed'];
  const users: Record<string, { id: string }> = {};
  for (const label of roles) users[label] = await world.user(label);
  await prisma.user.update({ where: { id: users.admin!.id }, data: { platformRole: 'ADMIN' } });
  const home = await world.team('home', users['home-owner']!.id, [
    { userId: users['home-captain']!.id, role: 'CAPTAIN' },
    { userId: users['home-member']!.id, role: 'MEMBER' },
    { userId: users.demoted!.id, role: 'CAPTAIN' },
    { userId: users.removed!.id, role: 'CAPTAIN' },
  ]);
  const away = await world.team('away', users['away-owner']!.id, [
    { userId: users['away-captain']!.id, role: 'CAPTAIN' },
    { userId: users['away-member']!.id, role: 'MEMBER' },
  ]);
  const input: CreateMatchInput = {
    managedFieldId: world.fieldId, name: `${world.marker}-match`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 1,
    rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: world.nextKickoff().toISOString(),
    playAsTeamId: home.id, otherSideMode: 'TEAMS_ONLY', teamSubstituteCount: 1,
  };
  const match = await matches.create(input, users['home-owner']!.id);
  world.matchIds.push(match.id);
  await teamMatches.loadTeam(match.id, users['away-owner']!.id, { teamId: away.id, substituteCount: 0 });
  // Demotion and removal take effect immediately.
  await prisma.teamMembership.update({ where: { teamId_userId: { teamId: home.id, userId: users.demoted!.id } }, data: { role: 'MEMBER' } });
  await new TeamsRepository().removeMember(home.id, users.removed!.id);
  const actors = roles.map((label) => ({ label, id: users[label]!.id }));

  await expectMatrix('update match (HOME)', actors, new Set(['home-owner', 'home-captain']),
    (actor) => matches.update(match.id, { description: `edited by ${actor.label}` }, actor.id));
  await expectMatrix('request HOME availability (own side)', actors, new Set(['home-owner', 'home-captain']),
    (actor) => availability.request(match.id, 'HOME', actor.id));
  await expectMatrix('request AWAY availability (own side)', actors, new Set(['away-owner', 'away-captain']),
    (actor) => availability.request(match.id, 'AWAY', actor.id));
  // Destructive commands last: withdraw (AWAY only), reload, then cancel (HOME only).
  await expectMatrix('withdraw team (AWAY)', actors, new Set(['away-owner', 'away-captain']), (actor) => teamMatches.withdrawTeam(match.id, actor.id), 'away-captain');
  await teamMatches.loadTeam(match.id, users['away-owner']!.id, { teamId: away.id, substituteCount: 0 });
  await expectMatrix('cancel match (HOME)', actors, new Set(['home-owner', 'home-captain']), (actor) => matches.remove(match.id, actor.id), 'home-captain');
  const cancelled = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
  assert(cancelled.status === 'CANCELLED' && cancelled.cancellationReason === 'TEAM_CANCELLED', 'The home captain\'s cancel was not recorded as a team cancellation.');
  const audit = await prisma.teamMatchAuditEvent.findFirstOrThrow({ where: { matchId: match.id, command: 'TEAM_MATCH_CANCELLED' } });
  assert(audit.actorUserId === users['home-captain']!.id, 'The cancellation was not audited with its actor.');
  const withdrawal = await prisma.teamMatchAuditEvent.findFirstOrThrow({ where: { matchId: match.id, command: 'OTHER_SIDE_TEAM_WITHDRAWN' } });
  assert(withdrawal.actorUserId === users['away-captain']!.id, 'The withdrawal was not audited with its actor.');
  console.log(`Gate 7 side-scoped authorization smoke passed (${actors.length} actors x 5 commands).`);
}

try {
  await main();
} finally {
  await world.cleanup();
  await prisma.$disconnect();
}
