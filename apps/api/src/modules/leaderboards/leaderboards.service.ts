import { leaderboardQuerySchema, type Leaderboard, type LeaderboardQuery } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import { playerAvatarUrl } from '../users/user.mapper.js';
import { rankLeaderboard, saMonthStart } from './leaderboard-ranking.js';

type Totals = {
  userId: string;
  matches: number;
  goals: number;
  assists: number;
  matchesReachedAt: Date | null;
  goalsReachedAt: Date | null;
  assistsReachedAt: Date | null;
};

/**
 * CEO touch-up batch 3.5, item 6 (D6): matches played, goals and assists for Cape Town, this month (by kick-off,
 * South African time) or all time. Exactly the profile-statistics rules (ToS 16.11): referee- or admin-final
 * results from the kickoff lineup record (players recorded as not playing, cancelled and abandoned matches don't
 * count; a forfeit is a match with no goals; own goals credit nobody), plus pre-Gate-8 results not under dispute.
 * FootyFinder runs only in Cape Town, so every match counts. Only active, onboarded players appear, with their
 * public name and photo (ToS 8.3). Nothing about venues or money.
 * Batch 5 brief, B3: a strict 1, 2, 3 order using each board's tie-breakers (see leaderboard-ranking.ts), top 10.
 */
export class LeaderboardsService {
  async get(query: LeaderboardQuery, viewerId?: string | null, now = new Date()): Promise<Leaderboard> {
    const { board, period } = leaderboardQuerySchema.parse(query);
    const since = period === 'month' ? saMonthStart(now) : new Date(0);
    const totals = await prisma.$queryRaw<Totals[]>`
      WITH played AS (
        SELECT e."userId", m."startsAt",
          (SELECT count(*) FROM "MatchGoal" g WHERE g."scorerEntryId" = e.id AND g."ownGoal" = false)::int AS goals,
          (SELECT count(*) FROM "MatchGoal" g WHERE g."assistEntryId" = e.id)::int AS assists
        FROM "MatchLineupEntry" e
        JOIN "Match" m ON m.id = e."matchId"
        JOIN "MatchResult" r ON r."matchId" = m.id
        WHERE e."didNotPlay" = false
          AND m.status = 'COMPLETED'
          AND r."finalSource" IN ('REFEREE', 'ADMIN')
          AND r."outcomeType" IN ('PLAYED', 'FORFEIT')
          AND m."startsAt" >= ${since}
        UNION ALL
        SELECT p."userId", m."startsAt",
          COALESCE((SELECT sum(s.goals) FROM "MatchScorer" s WHERE s."participantId" = p.id AND s."matchResultId" = r.id), 0)::int AS goals,
          0 AS assists
        FROM "MatchParticipant" p
        JOIN "Match" m ON m.id = p."matchId"
        JOIN "MatchResult" r ON r."matchId" = m.id
        WHERE p.status = 'JOINED'
          AND m.status = 'COMPLETED'
          AND r."finalSource" = 'LEGACY'
          AND m."startsAt" >= ${since}
          AND NOT EXISTS (
            SELECT 1 FROM "Dispute" d
            WHERE d.type = 'MATCH_RESULT' AND d."referenceId" = r.id AND d.status IN ('OPEN', 'UNDER_REVIEW')
          )
      )
      SELECT played."userId", count(*)::int AS matches, sum(played.goals)::int AS goals, sum(played.assists)::int AS assists,
        max(played."startsAt") AS "matchesReachedAt",
        max(played."startsAt") FILTER (WHERE played.goals > 0) AS "goalsReachedAt",
        max(played."startsAt") FILTER (WHERE played.assists > 0) AS "assistsReachedAt"
      FROM played
      JOIN "User" u ON u.id = played."userId"
      WHERE u."accountStatus" = 'ACTIVE' AND u."onboardingCompletedAt" IS NOT NULL
      GROUP BY played."userId"`;
    const counted = totals.filter((row) => row[board] > 0);
    const users = await prisma.user.findMany({
      where: { id: { in: counted.map(({ userId }) => userId) } },
      select: { id: true, username: true, createdAt: true, profile: { select: { displayName: true, avatarUrl: true, photo: { select: { hiddenAt: true } } } } },
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    const { rows, viewer } = rankLeaderboard(
      counted.flatMap((row) => {
        const user = byId.get(row.userId);
        return user
          ? [{
            userId: user.id,
            displayName: user.profile?.displayName ?? user.username,
            avatarUrl: playerAvatarUrl(user.id, user.profile) ?? null,
            matches: row.matches,
            goals: row.goals,
            assists: row.assists,
            reachedAt: { matches: row.matchesReachedAt, goals: row.goalsReachedAt, assists: row.assistsReachedAt },
            joinedAt: user.createdAt,
          }]
          : [];
      }),
      board,
      viewerId,
    );
    return { board, period, since: period === 'month' ? since.toISOString() : null, rows, viewer };
  }
}
