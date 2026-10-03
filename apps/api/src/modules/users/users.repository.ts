import type { RegisterInput, UpdatePlayerProfileInput } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import type { StatisticsRecord } from './player-statistics.js';

export const safeUserInclude = {
  profile: {
    include: {
      preferredPositions: { orderBy: { sortOrder: 'asc' as const } },
      city: true,
      photo: true,
    },
  },
  // Gate 8 / TKT-801: whether the account currently holds the referee role.
  refereeGrants: { where: { revokedAt: null }, select: { id: true }, take: 1 },
  teamMemberships: {
    include: { team: true },
    orderBy: { joinedAt: 'asc' as const },
  },
} as const;
export class UsersRepository {
  findById(id: string) {
    return prisma.user.findUnique({ where: { id }, include: safeUserInclude });
  }
  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email }, include: safeUserInclude });
  }
  findByUsername(username: string) {
    return prisma.user.findUnique({ where: { username }, include: safeUserInclude });
  }
  findByIdentifier(identifier: string) {
    return prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier.toLowerCase() },
          { username: { equals: identifier, mode: 'insensitive' } },
        ],
      },
      include: safeUserInclude,
    });
  }
  create(input: RegisterInput, passwordHash: string) {
    const displayName =
      [input.firstName, input.lastName].filter(Boolean).join(' ') || input.username;
    return prisma.user.create({
      data: {
        email: input.email,
        username: input.username,
        passwordHash,
        profile: { create: { displayName, onboardingStatus: 'IN_PROGRESS' } },
      },
      include: safeUserInclude,
    });
  }
  list() {
    return prisma.user.findMany({
      include: safeUserInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  /**
   * Gate 8 / TKT-808: every completed match that counts for the player. Referee-final and
   * admin-final results come from the kickoff lineup record (players who played, D14), with goals
   * and assists from the referee's goal list; own goals credit nobody (D7). Pre-Gate-8 self-reported
   * results (D20) keep the earlier rule: joined participants, excluding results under dispute.
   */
  async statistics(userId: string): Promise<StatisticsRecord[]> {
    const entries = await prisma.matchLineupEntry.findMany({
      where: {
        userId,
        didNotPlay: false,
        match: { status: 'COMPLETED', result: { finalSource: { in: ['REFEREE', 'ADMIN'] }, outcomeType: { in: ['PLAYED', 'FORFEIT'] } } },
      },
      select: {
        side: true,
        match: { select: { result: { select: { outcomeType: true, homeScore: true, awayScore: true, forfeitWinner: true } } } },
        _count: { select: { goalsScored: { where: { ownGoal: false } }, goalsAssisted: true } },
      },
    });
    const refereed: StatisticsRecord[] = entries.map(({ side, match, _count }) => ({
      side,
      outcomeType: match.result!.outcomeType,
      homeScore: match.result!.homeScore,
      awayScore: match.result!.awayScore,
      forfeitWinner: match.result!.forfeitWinner,
      goals: _count.goalsScored,
      assists: _count.goalsAssisted,
    }));
    return [...refereed, ...(await this.legacyStatistics(userId))];
  }
  private async legacyStatistics(userId: string): Promise<StatisticsRecord[]> {
    const participations = await prisma.matchParticipant.findMany({
      where: { userId, status: 'JOINED', match: { status: 'COMPLETED', result: { finalSource: 'LEGACY' } } },
      include: { match: { include: { result: true } }, scoring: true },
    });
    const resultIds = participations.flatMap(({ match }) => match.result ? [match.result.id] : []);
    const disputed = resultIds.length
      ? await prisma.dispute.findMany({
          where: { type: 'MATCH_RESULT', referenceId: { in: resultIds }, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
          select: { referenceId: true },
        })
      : [];
    const disputedIds = new Set(disputed.map(({ referenceId }) => referenceId));
    return participations
      .filter(({ match }) => match.result && !disputedIds.has(match.result.id))
      .map(({ team, match, scoring }) => ({
        side: team,
        outcomeType: match.result!.outcomeType,
        homeScore: match.result!.homeScore,
        awayScore: match.result!.awayScore,
        forfeitWinner: match.result!.forfeitWinner,
        goals: scoring.reduce((total, scorer) => total + scorer.goals, 0),
        assists: 0,
      }));
  }
  updateProfile(userId: string, input: UpdatePlayerProfileInput) {
    const { preferredPositions, ...profile } = input;
    return prisma.user.update({
      where: { id: userId },
      data: {
        profile: {
          upsert: {
            create: {
              ...profile,
              displayName: input.displayName,
              preferredPositions: {
                create: preferredPositions.map((position, sortOrder) => ({ position, sortOrder })),
              },
            },
            update: {
              ...profile,
              preferredPositions: {
                deleteMany: {},
                create: preferredPositions.map((position, sortOrder) => ({ position, sortOrder })),
              },
            },
          },
        },
      },
      include: safeUserInclude,
    });
  }
}
