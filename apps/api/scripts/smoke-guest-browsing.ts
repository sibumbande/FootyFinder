import './assert-disposable-test-database.js';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { getDefaultFormationKey } from '@footy-finder/shared';
import { app } from '../src/app.js';
import { prisma } from '../src/database/prisma.js';
import { RecruitmentService } from '../src/modules/social/recruitment.service.js';
import { TeamsRepository } from '../src/modules/teams/teams.repository.js';
import { assert, socialWorld } from './social-fixtures.js';
import { deleteTeamWalletFixtures } from './team-wallet-fixtures.js';

/**
 * Gate 9 / TKT-910 over HTTP with no account: guests get read-only, guest-safe views of public
 * matches (counts only before kick-off, scorers after the result), teams, profiles and the
 * recruitment board, and every signed-in route still answers 401.
 */
const world = socialWorld(`gate9-guest-${randomUUID()}`);
const recruitment = new RecruitmentService();
const teamIds: string[] = [];
const extraMatchIds: string[] = [];
// CEO touch-up batch 4, item 1: gender (key or value) never reaches guests.
const PRIVATE = /email|dateOfBirth|gender|"(FE)?MALE"|balance|wallet|passwordHash|conversation|friendRequests|priceCents|amountCents/i;
const guest = () => request(app);

async function main() {
  const [owner, member, scorer, opponent] = await Promise.all(['Owner', 'Member', 'Scorer', 'Opponent'].map((name) => world.player(name)));
  await prisma.user.update({ where: { id: scorer!.id }, data: { profile: { update: { bio: 'Left-footed winger', homeArea: 'Secret Street 1', dateOfBirth: new Date('1995-05-05'), gender: 'FEMALE' } } } });
  const team = await new TeamsRepository().create({ name: `${world.marker}-FC`, primaryFormat: 'FIVE_A_SIDE', formationKey: getDefaultFormationKey('FIVE_A_SIDE') }, owner!.id);
  teamIds.push(team.id);
  await prisma.teamMembership.create({ data: { teamId: team.id, userId: member!.id, role: 'MEMBER' } });

  // An upcoming public match with a player in it, and a private one that must never be listed.
  const venue = await prisma.venue.create({ data: { name: `${world.marker} park`, addressLine1: '1 Guest Road', city: 'Cape Town', region: 'Western Cape', countryCode: 'ZA' } });
  const startsAt = new Date(Date.now() + 3 * 86_400_000);
  const upcoming = await prisma.match.create({
    data: {
      name: `${world.marker} upcoming`, createdById: owner!.id, venueId: venue.id, mode: 'QUICK_GAME', format: 'FIVE_A_SIDE', visibility: 'PUBLIC',
      publicSlug: `m-${randomBytes(12).toString('hex')}`, startsAt, durationMinutes: 60, feeCents: 8_000, status: 'OPEN', goNoGoAt: new Date(startsAt.getTime() - 30 * 60_000),
      participants: { create: { userId: scorer!.id, team: 'HOME' } },
    },
  });
  const hidden = await prisma.match.create({
    data: { name: `${world.marker} private`, createdById: owner!.id, venueId: venue.id, mode: 'QUICK_GAME', format: 'FIVE_A_SIDE', visibility: 'PRIVATE', startsAt, durationMinutes: 60, feeCents: 8_000, status: 'OPEN', goNoGoAt: new Date(startsAt.getTime() - 30 * 60_000) },
  });
  extraMatchIds.push(upcoming.id, hidden.id);

  // A played match with a referee's final result and a scorer.
  const finished = await world.finishedMatch([scorer!.id, member!.id], [opponent!.id]);
  const scorerEntry = await prisma.matchLineupEntry.findFirstOrThrow({ where: { matchId: finished.id, userId: scorer!.id } });
  const assistEntry = await prisma.matchLineupEntry.findFirstOrThrow({ where: { matchId: finished.id, userId: member!.id } });
  await prisma.matchResult.create({
    data: {
      matchId: finished.id, homeScore: 1, awayScore: 0, outcomeType: 'PLAYED', submittedById: owner!.id, finalSource: 'REFEREE', finalizedById: owner!.id, finalizedAt: new Date(),
      goals: { create: [{ side: 'HOME', sortOrder: 0, scorerEntryId: scorerEntry.id, assistEntryId: assistEntry.id }] },
    },
  });

  // Recruitment: a team post and a looking card.
  const post = await recruitment.createPost(owner!.id, team.id, { positions: ['DEFENDER'], playersWanted: 1, format: 'FIVE_A_SIDE', level: 'CASUAL', days: [], times: [], area: 'Woodstock' });
  await recruitment.updateCard(opponent!.id, { enabled: true, positions: ['FORWARD'], area: 'Salt River', days: [], times: [] });

  // Public match list and pages: counts only before kick-off, no private matches.
  const list = await guest().get('/public/matches').expect(200);
  const listed = list.body.data.find((match: { slug: string }) => match.slug === upcoming.publicSlug);
  assert(listed && listed.capacity.filled === 1 && listed.feeCents === 8_000, 'The upcoming public match is not listed with its count and fee.');
  assert(!JSON.stringify(list.body).includes(hidden.id) && !JSON.stringify(list.body).includes(`${world.marker} private`), 'A private match was listed.');
  assert(!JSON.stringify(list.body).match(PRIVATE) && !JSON.stringify(list.body).includes('Scorer'), 'The public list exposed a name or private data.');
  const played = await guest().get(`/public/matches/${finished.publicSlug}`).expect(200);
  assert(played.body.data.result?.goals?.[0]?.scorer?.length && played.body.data.result.homeScore === 1, 'The played match does not show its scorer.');
  // CEO touch-up batch 2, item 5: a guest opening a /matches/:id link gets the same counts-only view; private matches stay hidden.
  const byId = await guest().get(`/public/matches/by-id/${upcoming.id}`).expect(200);
  assert(byId.body.data.slug === upcoming.publicSlug && byId.body.data.capacity.filled === 1 && byId.body.data.sides, 'The guest match view by id is wrong.');
  assert(!JSON.stringify(byId.body).match(PRIVATE) && !JSON.stringify(byId.body).includes('Scorer') && !JSON.stringify(byId.body).includes(scorer!.id), 'The guest match view by id exposed a name or private data.');
  await guest().get(`/public/matches/by-id/${hidden.id}`).expect(404);

  // Team page, player profile and recruitment board.
  const teamView = await guest().get(`/public/teams/${team.id}`).expect(200);
  assert(teamView.body.data.members.length === 2 && !JSON.stringify(teamView.body).match(PRIVATE), 'The public team page is wrong or leaks private data.');
  const profile = await guest().get(`/public/players/${scorer!.id}`).expect(200);
  assert(profile.body.data.bio === 'Left-footed winger' && profile.body.data.statistics, 'The guest profile is missing public fields.');
  assert(!JSON.stringify(profile.body).match(/Secret Street|1995|homeArea|dominantFoot|yearsExperience/) && !JSON.stringify(profile.body).match(PRIVATE), 'The guest profile exposed more than the CEO list.');
  const posts = await guest().get('/public/recruitment/posts').expect(200);
  assert(posts.body.data.some(({ id }: { id: string }) => id === post.id), 'Guests cannot see recruitment posts.');
  const looking = await guest().get('/public/recruitment/looking').expect(200);
  assert(looking.body.data.some(({ player }: { player: { id: string } }) => player.id === opponent!.id), 'Guests cannot see looking cards.');
  assert(!JSON.stringify(posts.body).match(PRIVATE) && !JSON.stringify(looking.body).match(PRIVATE), 'The board leaked private data.');
  await guest().get(`/players/${scorer!.id}/photo`).expect(404);

  // Everything that needs a profile still needs a session.
  for (const [method, path] of [
    ['get', '/matches'], ['get', `/matches/${upcoming.id}`], ['post', `/matches/${upcoming.id}/tickets/checkout`], ['get', `/players/${scorer!.id}`],
    ['get', '/social/friends'], ['get', '/social/search?q=gate'], ['post', '/social/friend-requests'], ['get', '/conversations'],
    ['get', '/tickets/mine'], ['get', `/teams/${team.id}`], ['post', `/social/recruitment/posts/${post.id}/join-requests`], ['get', `/matches/${finished.id}/result-context`],
  ] as const) {
    const response = await (method === 'get' ? guest().get(path) : guest().post(path).send({}));
    assert(response.status === 401, `${method.toUpperCase()} ${path} answered ${response.status} to a guest.`);
  }

  console.log('Guest browsing smoke passed: public match list (counts and the R80 fee, no names, no private matches), played-match scorers, public team page, guest profile (CEO fields only), recruitment posts and looking cards, public photos, and 401 on every signed-in route.');
}

try {
  await main();
} finally {
  await prisma.match.deleteMany({ where: { id: { in: extraMatchIds } } }).catch(() => undefined);
  await prisma.venue.deleteMany({ where: { name: { startsWith: world.marker } } }).catch(() => undefined);
  await deleteTeamWalletFixtures(teamIds).catch(() => undefined);
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } }).catch(() => undefined);
  await world.cleanup().catch((error: unknown) => {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  });
  await prisma.$disconnect();
}
