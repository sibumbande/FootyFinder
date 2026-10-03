import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import type { CreateMatchInput } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { GirlsOnlyAdminService } from '../src/modules/admin/girls-only.admin.service.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { MatchAvailabilityService } from '../src/modules/match-availability/match-availability.service.js';
import { MatchLineupService } from '../src/modules/match-lineup/match-lineup.service.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { OnboardingService } from '../src/modules/onboarding/onboarding.service.js';
import { toPublicUser } from '../src/modules/users/user.mapper.js';
import { assert, rejectsWith, teamMatchWorld } from './team-match-fixtures.js';
import { buyTicket } from './support/ticket-fixtures.js';

/**
 * CEO touch-up batch 4, item 1 on PostgreSQL: girls-only matches. Only female players can join, claim, be selected,
 * invited or asked for availability, or be loaded with a team; male members are left out of a team's copied squad
 * (and the captain is told); switching the rule on or off follows D3; an admin correction is audited and lists the
 * matches to follow up; gender is saved once by the player and never appears in public data.
 */
const world = teamMatchWorld(`girls-${randomUUID()}`);
const matches = new MatchesService();
const bookings = new BookingsService();
const lineups = new MatchLineupService();
const availability = new MatchAvailabilityService();
const admin = new GirlsOnlyAdminService();
const onboarding = new OnboardingService();
const setGender = (userId: string, gender: 'MALE' | 'FEMALE' | null) => prisma.playerProfile.update({ where: { userId }, data: { gender } });

async function main() {
  await world.venue();
  // One at a time: each seeds a wallet credit, and parallel serializable credits can conflict.
  const players = [];
  for (const name of ['Anele', 'Buhle', 'Sipho', 'Thabo', 'Owner']) players.push(await world.user(name));
  const [anele, buhle, sipho, thabo, owner] = players;
  for (const player of [anele, buhle, owner]) await setGender(player!.id, 'FEMALE');
  for (const player of [sipho, thabo]) await setGender(player!.id, 'MALE');
  const adminUser = await prisma.user.create({ data: { email: `admin-${world.marker}@smoke.invalid`, username: `go_${randomUUID().slice(0, 10)}`, passwordHash: 'smoke-test-only', platformRole: 'ADMIN' } });

  // Quick match: a male player is refused, a female player joins.
  const quick = await bookings.createQuickMatch({ managedFieldId: world.fieldId, name: `${world.marker} girls quick`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 2, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', girlsOnly: true, startsAt: world.nextKickoff().toISOString() }, sipho!.id);
  world.matchIds.push(quick.id);
  assert(quick.girlsOnly, 'The quick match was not girls-only.');
  assert(await rejectsWith(() => buyTicket(quick.id, thabo!.id, 'HOME', `${world.marker}-thabo`), 'GIRLS_ONLY'), 'A male player joined a girls-only match.');
  await buyTicket(quick.id, anele!.id, 'HOME', `${world.marker}-anele`);
  // A player with no gender saved yet is not eligible either.
  await setGender(buhle!.id, null);
  assert(await rejectsWith(() => buyTicket(quick.id, buhle!.id, 'AWAY', `${world.marker}-buhle-none`), 'GIRLS_ONLY'), 'A player with no gender joined a girls-only match.');
  // The player saves it once; a second save is refused (only an admin corrects it).
  await onboarding.setGender(buhle!.id, 'FEMALE');
  assert(await rejectsWith(() => onboarding.setGender(buhle!.id, 'MALE'), 'GENDER_ALREADY_SET'), 'A player changed their own gender.');

  // D3: girls-only cannot be switched off once anyone joined, nor on once a male player joined.
  assert(await rejectsWith(() => admin.setMatch(quick.id, { girlsOnly: false, reason: 'Open it up please' }, adminUser.id, world.marker), 'GIRLS_ONLY_HAS_PLAYERS'), 'Girls-only was switched off after players joined.');
  const open = await bookings.createQuickMatch({ managedFieldId: world.fieldId, name: `${world.marker} open quick`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 2, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: world.nextKickoff().toISOString() }, sipho!.id);
  world.matchIds.push(open.id);
  await buyTicket(open.id, thabo!.id, 'HOME', `${world.marker}-thabo-open`);
  assert(await rejectsWith(() => admin.setMatch(open.id, { girlsOnly: true, reason: 'Women only night' }, adminUser.id, world.marker), 'GIRLS_ONLY_HAS_INELIGIBLE'), 'Girls-only was switched on after a male player joined.');
  const empty = await bookings.createQuickMatch({ managedFieldId: world.fieldId, name: `${world.marker} empty quick`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 2, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: world.nextKickoff().toISOString() }, sipho!.id);
  world.matchIds.push(empty.id);
  assert((await admin.setMatch(empty.id, { girlsOnly: true, reason: 'Women only night' }, adminUser.id, world.marker)).girlsOnly, 'An empty match could not be made girls-only.');
  assert((await prisma.adminAuditLog.count({ where: { requestId: world.marker, action: 'MATCH_GIRLS_ONLY_ON' } })) === 1, 'Switching girls-only on was not audited.');

  // Team match: the male member is left out of the copied squad, the owner is told, and lineups refuse him.
  const team = await world.team('girls', owner!.id, [{ userId: anele!.id, role: 'CAPTAIN' }, { userId: sipho!.id, role: 'MEMBER' }, { userId: buhle!.id, role: 'MEMBER' }]);
  const formation = await prisma.teamFormation.findUniqueOrThrow({ where: { teamId_format: { teamId: team.id, format: 'FIVE_A_SIDE' } }, include: { slots: true } });
  const slots = [...formation.slots].sort((a, b) => a.slotIndex - b.slotIndex);
  for (const [index, userId] of [owner!.id, sipho!.id].entries()) {
    const membership = await prisma.teamMembership.findUniqueOrThrow({ where: { teamId_userId: { teamId: team.id, userId } } });
    await prisma.teamFormationSlot.update({ where: { id: slots[index]!.id }, data: { membershipId: membership.id } });
  }
  const input: CreateMatchInput = { managedFieldId: world.fieldId, name: `${world.marker} girls team`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 2, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', girlsOnly: true, startsAt: world.nextKickoff().toISOString(), playAsTeamId: team.id, otherSideMode: 'OPEN', teamSubstituteCount: 2 };
  const teamMatch = await matches.create(input, owner!.id);
  world.matchIds.push(teamMatch.id);
  const home = await prisma.matchTeam.findUniqueOrThrow({ where: { matchId_side: { matchId: teamMatch.id, side: 'HOME' } }, include: { selections: true } });
  assert(home.selections.some(({ userId }) => userId === owner!.id), 'The eligible squad member was not copied into the lineup.');
  assert(!home.selections.some(({ userId }) => userId === sipho!.id), 'A male member was copied into a girls-only lineup.');
  assert((await prisma.notification.count({ where: { userId: owner!.id, title: 'Girls-only match: some players were left out' } })) === 1, 'The owner was not told who was left out.');
  assert(await rejectsWith(() => lineups.invite(teamMatch.id, 'HOME', sipho!.id, owner!.id), 'GIRLS_ONLY'), 'A male member was invited into a girls-only lineup.');
  assert(await rejectsWith(() => lineups.selectSubstitute(teamMatch.id, 'HOME', sipho!.id, owner!.id), 'GIRLS_ONLY'), 'A male member was made a girls-only substitute.');
  await lineups.selectSubstitute(teamMatch.id, 'HOME', buhle!.id, owner!.id);
  // Availability goes only to eligible members.
  await availability.request(teamMatch.id, 'HOME', owner!.id);
  const asked = await prisma.teamMatchAvailability.findMany({ where: { matchTeamId: home.id }, select: { userId: true } });
  assert(!asked.some(({ userId }) => userId === sipho!.id) && asked.some(({ userId }) => userId === anele!.id), 'Availability was asked of a male member.');
  // An individual taking the other side is checked like any join.
  assert(await rejectsWith(() => buyTicket(teamMatch.id, thabo!.id, 'AWAY', `${world.marker}-thabo-away`), 'GIRLS_ONLY'), 'A male player took a girls-only other side.');

  // D4: an admin correction is audited and lists the girls-only matches the player is now not eligible for.
  const corrected = await admin.correctGender(anele!.id, { gender: 'MALE', reason: 'Player asked support to correct it' }, adminUser.id, world.marker);
  assert(corrected.affectedMatches.some(({ matchId }) => matchId === quick.id), 'The correction did not list the affected match.');
  const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { requestId: world.marker, action: 'PLAYER_GENDER_CORRECTED' } });
  assert((audit.metadata as { from?: string; to?: string }).from === 'FEMALE' && (audit.metadata as { to?: string }).to === 'MALE', 'The correction audit is wrong.');
  assert((await prisma.matchParticipant.count({ where: { matchId: quick.id, userId: anele!.id, status: 'JOINED' } })) === 1, 'The correction changed a match automatically.');

  // Privacy: never in public or other-user data.
  const user = await prisma.user.findUniqueOrThrow({ where: { id: buhle!.id }, include: { profile: { include: { preferredPositions: true, photo: true, city: true } } } });
  assert(!/gender|FEMALE/i.test(JSON.stringify(toPublicUser(user))), 'Gender reached public player data.');
  const preview = await matches.publicPreview((await prisma.match.findUniqueOrThrow({ where: { id: quick.id } })).publicSlug!);
  assert(preview.girlsOnly && !/gender|"(FE)?MALE"/i.test(JSON.stringify(preview)), 'The public preview is missing girls-only or exposed a gender.');
  const lobby = await matches.get(quick.id, buhle!.id);
  assert(!/gender|"(FE)?MALE"/i.test(JSON.stringify(lobby)), 'A lobby exposed a player\'s gender.');
  console.log('Girls-only smoke passed: male and no-gender players refused at join, invite, substitute, other side and availability; male members left out of a copied squad (captain told); D3 on/off rules (audited); gender saved once by the player; admin correction audited with the matches to follow up and nothing changed automatically; gender never in public, lobby or preview data.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await world.cleanup().catch((error) => console.error('cleanup failed', error));
    await prisma.$disconnect();
  });
