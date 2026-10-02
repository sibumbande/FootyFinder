import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { PublicBrowseService } from '../src/modules/public/public-browse.service.js';
import { teamStats } from '../src/modules/teams/team-stats.js';
import { assert, teamMatchWorld } from './team-match-fixtures.js';

/**
 * CEO touch-up batch 4, item 2 on PostgreSQL: team statistics count only final results (referee/admin-final, plus
 * undisputed legacy results), skip abandoned and unrecorded matches, count a forfeit as a win or loss with no goals,
 * and members and guests see the same numbers.
 */
const world = teamMatchWorld(`tstats-${randomUUID()}`);

async function finished(home: { id: string; name: string }, away: { id: string; name: string } | null, startsAt: Date, result?: { finalSource: 'REFEREE' | 'ADMIN' | 'LEGACY'; outcomeType: 'PLAYED' | 'FORFEIT' | 'ABANDONED'; homeScore: number; awayScore: number; forfeitWinner?: 'HOME' | 'AWAY' }, submittedById?: string) {
  const venue = await prisma.venue.create({ data: { name: `${world.marker} venue`, addressLine1: '1 Smoke Road', city: 'Cape Town', region: 'Western Cape', countryCode: 'ZA' } });
  const match = await prisma.match.create({
    data: {
      venueId: venue.id, name: `${world.marker} result ${randomUUID().slice(0, 6)}`, createdById: submittedById!, mode: 'TEAM_MATCH', format: 'FIVE_A_SIDE',
      visibility: 'PUBLIC', startsAt, durationMinutes: 60, feeCents: 8_000, status: 'COMPLETED', otherSideMode: 'OPEN', otherSideTakenBy: away ? 'TEAM' : 'INDIVIDUALS', goNoGoAt: new Date(startsAt.getTime() - 30 * 60_000), publicSlug: `m-${randomUUID().replaceAll('-', '').slice(0, 24)}`,
      teamSides: { create: [{ teamId: home.id, side: 'HOME', teamNameSnapshot: home.name, organisingUserId: submittedById!, formationKey: 'BALANCED_1_1_2_1' }, ...(away ? [{ teamId: away.id, side: 'AWAY' as const, teamNameSnapshot: away.name, organisingUserId: submittedById!, formationKey: 'BALANCED_1_1_2_1' }] : [])] },
    },
  });
  world.matchIds.push(match.id);
  if (!result) return match;
  const created = await prisma.matchResult.create({
    data: {
      matchId: match.id, submittedById: submittedById!, homeScore: result.homeScore, awayScore: result.awayScore, outcomeType: result.outcomeType,
      forfeitWinner: result.forfeitWinner ?? null, finalSource: result.finalSource,
      ...(result.finalSource === 'LEGACY' ? {} : { finalizedById: submittedById!, finalizedAt: new Date() }),
    },
  });
  return { ...match, resultId: created.id };
}

async function main() {
  const owner = await world.user('Stats Owner');
  const rival = await world.user('Rival Owner');
  const home = await world.team('stats', owner.id);
  const away = await world.team('rival', rival.id);
  const day = (n: number) => new Date(Date.now() - n * 86_400_000);
  await finished(home, away, day(10), { finalSource: 'REFEREE', outcomeType: 'PLAYED', homeScore: 3, awayScore: 1 }, owner.id);
  await finished(away, home, day(8), { finalSource: 'ADMIN', outcomeType: 'PLAYED', homeScore: 2, awayScore: 2 }, owner.id);
  await finished(home, null, day(6), { finalSource: 'REFEREE', outcomeType: 'FORFEIT', homeScore: 0, awayScore: 0, forfeitWinner: 'AWAY' }, owner.id);
  await finished(home, away, day(5), { finalSource: 'REFEREE', outcomeType: 'ABANDONED', homeScore: 0, awayScore: 0 }, owner.id);
  await finished(home, away, day(4), undefined, owner.id);
  await finished(home, away, day(3), { finalSource: 'LEGACY', outcomeType: 'PLAYED', homeScore: 1, awayScore: 0 }, owner.id);
  const disputed = await finished(home, away, day(2), { finalSource: 'LEGACY', outcomeType: 'PLAYED', homeScore: 9, awayScore: 0 }, owner.id);
  await prisma.dispute.create({ data: { type: 'MATCH_RESULT', referenceId: (disputed as { resultId: string }).resultId, openedByUserId: owner.id, reason: 'INCORRECT_SCORE', details: 'The score was recorded wrongly.', evidenceSnapshot: {} } });

  const stats = await teamStats(home.id);
  assert(stats.played === 4 && stats.wins === 2 && stats.draws === 1 && stats.losses === 1, `Wrong W/D/L: ${JSON.stringify(stats)}`);
  assert(stats.goalsFor === 6 && stats.goalsAgainst === 3 && stats.goalDifference === 3, `Wrong goals: ${JSON.stringify(stats)}`);
  assert(stats.lastFive.map(({ outcome }) => outcome).join('') === 'WLDW', `Wrong last five: ${stats.lastFive.map(({ outcome }) => outcome).join('')}`);
  assert(stats.lastFive[1]!.forfeit && stats.lastFive[1]!.opponent === 'Individual players', 'The forfeit or the individuals opponent is wrong.');
  const guest = await new PublicBrowseService().team(home.id);
  assert(JSON.stringify(guest.stats) === JSON.stringify(stats), 'Guests and members see different team statistics.');
  console.log('Team stats smoke passed: referee/admin-final and undisputed legacy results count; abandoned, unrecorded and disputed results do not; a forfeit is a loss with no goals; last five newest first; guests see the same numbers.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.dispute.deleteMany({ where: { details: 'The score was recorded wrongly.', referenceId: { in: (await prisma.matchResult.findMany({ where: { matchId: { in: world.matchIds } }, select: { id: true } })).map(({ id }) => id) } } }).catch(() => undefined);
    await prisma.matchResult.deleteMany({ where: { matchId: { in: world.matchIds } } }).catch(() => undefined);
    await world.cleanup().catch((error) => console.error('cleanup failed', error));
    await prisma.$disconnect();
  });
