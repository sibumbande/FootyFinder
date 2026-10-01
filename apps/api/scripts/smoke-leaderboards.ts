import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import type { LeaderboardBoard, LeaderboardPeriod } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { saMonthStart } from '../src/modules/leaderboards/leaderboard-ranking.js';
import { LeaderboardsService } from '../src/modules/leaderboards/leaderboards.service.js';
import { socialWorld } from './social-fixtures.js';

/**
 * CEO touch-up batch 3.5, item 6 on PostgreSQL: the leaderboards count exactly what profile statistics count.
 * Only referee- or admin-final results; players recorded as not playing, abandoned, unrecorded and cancelled
 * matches do not count; own goals credit nobody; "This month" starts on the 1st in South African time; suspended
 * players never appear; and the board says nothing about venues or money.
 */
const world = socialWorld(`lb-${randomUUID().slice(0, 8)}`);
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const service = new LeaderboardsService();
/** The player's place on a board, whether shown in the top rows or returned as the viewer's own row. */
const place = async (board: LeaderboardBoard, period: LeaderboardPeriod, userId: string) => {
  const result = await service.get({ board, period }, userId);
  return result.rows.find((row) => row.userId === userId) ?? result.viewer;
};

type GoalSpec = { side: 'HOME' | 'AWAY'; scorer?: string; assist?: string; ownGoal?: boolean };
async function result(matchId: string, submittedById: string, finalSource: 'REFEREE' | 'ADMIN', outcomeType: 'PLAYED' | 'ABANDONED', goals: GoalSpec[] = []) {
  const entries = await prisma.matchLineupEntry.findMany({ where: { matchId }, select: { id: true, userId: true } });
  const entry = (userId?: string) => (userId ? entries.find((item) => item.userId === userId)!.id : null);
  await prisma.matchResult.create({
    data: {
      matchId, submittedById, finalSource, outcomeType, finalizedById: submittedById, finalizedAt: new Date(),
      homeScore: goals.filter(({ side }) => side === 'HOME').length,
      awayScore: goals.filter(({ side }) => side === 'AWAY').length,
      goals: { create: goals.map((goal, sortOrder) => ({ side: goal.side, sortOrder, ownGoal: Boolean(goal.ownGoal), scorerEntryId: entry(goal.scorer), assistEntryId: entry(goal.assist) })) },
    },
  });
}

try {
  const [striker, keeper, bench, winger, suspended] = await Promise.all(['Striker', 'Keeper', 'Bench', 'Winger', 'Suspended'].map((label) => world.player(label)));
  const now = new Date();
  const thisMonth = new Date(Math.max(now.getTime() - 3 * 3_600_000, saMonthStart(now).getTime() + 60_000));
  const lastMonth = new Date(saMonthStart(now).getTime() - 2 * 86_400_000);

  // This month, referee-final: striker scores twice (once assisted by the winger); an own goal credits nobody.
  const played = await world.finishedMatch([striker.id, winger.id, bench.id, suspended.id], [keeper.id], { didNotPlay: [bench.id], startsAt: thisMonth });
  await result(played.id, striker.id, 'REFEREE', 'PLAYED', [
    { side: 'HOME', scorer: striker.id, assist: winger.id },
    { side: 'HOME', scorer: striker.id },
    { side: 'AWAY', ownGoal: true },
  ]);
  // This month but abandoned (admin-final), and one with no result yet: neither counts.
  const abandoned = await world.finishedMatch([striker.id], [keeper.id], { startsAt: thisMonth });
  await result(abandoned.id, striker.id, 'ADMIN', 'ABANDONED');
  await world.finishedMatch([striker.id], [keeper.id], { startsAt: thisMonth });
  // A cancelled match with a recorded result never counts.
  const cancelled = await world.finishedMatch([striker.id], [keeper.id], { startsAt: thisMonth });
  await result(cancelled.id, striker.id, 'REFEREE', 'PLAYED', [{ side: 'HOME', scorer: striker.id }]);
  await prisma.match.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } });
  // Last month: the keeper scores; it counts for all time only.
  const old = await world.finishedMatch([striker.id], [keeper.id], { startsAt: lastMonth });
  await result(old.id, striker.id, 'REFEREE', 'PLAYED', [{ side: 'AWAY', scorer: keeper.id }]);
  await prisma.user.update({ where: { id: suspended.id }, data: { accountStatus: 'SUSPENDED' } });

  assert((await place('matches', 'month', striker.id))?.value === 1, 'Matches this month should count only the final, played match.');
  assert((await place('matches', 'all', striker.id))?.value === 2, 'All-time matches should add last month.');
  assert((await place('matches', 'month', bench.id)) === null, 'A player recorded as not playing was counted.');
  assert((await place('goals', 'month', striker.id))?.value === 2, 'Goals this month are wrong (cancelled or own goals counted?).');
  assert((await place('goals', 'month', keeper.id)) === null && (await place('goals', 'all', keeper.id))?.value === 1, 'Last month\'s goal is in the wrong period.');
  assert((await place('assists', 'month', winger.id))?.value === 1, 'The assist was not counted.');
  assert((await place('matches', 'month', suspended.id)) === null, 'A suspended player appears on a leaderboard.');

  const board = await service.get({ board: 'goals', period: 'all' }, null);
  assert(board.viewer === null && board.since === null, 'A guest got a viewer row, or "all time" has a start date.');
  assert(!/price|venue|cents|wallet|email/i.test(JSON.stringify(board)), 'The leaderboard carries venue, money or contact data.');
  console.log('Leaderboards smoke passed: only referee/admin-final results count (not-playing, abandoned, unrecorded and cancelled matches excluded, own goals credit nobody), this month starts on the 1st in SA time, assists count, suspended players never appear, and the board carries no venue, money or contact data.');
} finally {
  await prisma.matchGoal.deleteMany({ where: { matchResult: { matchId: { in: world.matchIds } } } }).catch(() => undefined);
  await prisma.matchResult.deleteMany({ where: { matchId: { in: world.matchIds } } }).catch(() => undefined);
  await prisma.matchLineupEntry.deleteMany({ where: { matchId: { in: world.matchIds } } }).catch(() => undefined);
  await world.cleanup().catch((error) => console.error('cleanup failed', error));
  await prisma.$disconnect();
}
