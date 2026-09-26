import type { RegisterInput, UpdatePlayerProfileInput } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';

export const safeUserInclude = {
  profile: {
    include: {
      preferredPositions: { orderBy: { sortOrder: 'asc' as const } },
      city: true,
      photo: true,
    },
  },
  walletAccount: true,
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
        walletAccount: { create: { currency: 'ZAR' } },
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
  async statistics(userId: string) {
    const participations = await prisma.matchParticipant.findMany({
      where: { userId, status: 'JOINED', match: { status: 'COMPLETED', result: { isNot: null } } },
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
    return participations.filter(({ match }) => match.result && !disputedIds.has(match.result.id));
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
