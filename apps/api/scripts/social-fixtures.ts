import { randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';

export const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
export const rejectsWith = async (work: () => Promise<unknown>, code: string) => {
  try {
    await work();
  } catch (error) {
    if ((error as { code?: string }).code === code) return true;
    throw new Error(`Expected ${code} but got ${(error as { code?: string }).code ?? String(error)}`);
  }
  throw new Error(`Expected ${code} but the call succeeded.`);
};

/**
 * Gate 9 smoke fixtures on the disposable database: onboarded players (they can send and receive
 * friend requests) and finished matches with a Lineup Record. Everything is removed by `cleanup`.
 */
export function socialWorld(marker: string) {
  const userIds: string[] = [];
  const matchIds: string[] = [];
  const venueIds: string[] = [];
  let index = 0;
  return {
    marker,
    userIds,
    matchIds,
    async player(label: string, options: { friendRequestsEnabled?: boolean } = {}) {
      const n = index++;
      const user = await prisma.user.create({
        data: {
          email: `${marker}-${n}@smoke.invalid`,
          username: `g9_${marker.slice(-8)}_${n}`,
          passwordHash: 'smoke-test-only',
          emailVerifiedAt: new Date(),
          onboardingCompletedAt: new Date(),
          friendRequestsEnabled: options.friendRequestsEnabled ?? true,
          profile: { create: { displayName: `${label} ${marker.slice(-4)}`, onboardingStatus: 'COMPLETE' } },
          walletAccount: { create: {} },
        },
      });
      userIds.push(user.id);
      return user;
    },
    /** A finished (COMPLETED) match whose kickoff Lineup Record holds these players. */
    async finishedMatch(home: string[], away: string[], options: { didNotPlay?: string[]; startsAt?: Date; refereeUserId?: string } = {}) {
      const startsAt = options.startsAt ?? new Date(Date.now() - 3 * 3_600_000);
      const venue = await prisma.venue.create({ data: { name: `${marker} venue`, addressLine1: '1 Smoke Road', city: 'Cape Town', region: 'Western Cape', countryCode: 'ZA' } });
      const match = await prisma.match.create({
        data: {
          venueId: venue.id,
          name: `${marker} finished ${randomUUID().slice(0, 6)}`,
          createdById: home[0]!,
          mode: 'QUICK_GAME',
          format: 'FIVE_A_SIDE',
          visibility: 'PUBLIC',
          publicSlug: `m-${randomBytes(12).toString('hex')}`,
          startsAt,
          durationMinutes: 60,
          feeCents: 8_000,
          status: 'COMPLETED',
          goNoGoAt: new Date(startsAt.getTime() - 30 * 60_000),
          confirmedAt: new Date(startsAt.getTime() - 30 * 60_000),
          ...(options.refereeUserId ? { refereeUserId: options.refereeUserId, refereeAssignedAt: new Date(startsAt.getTime() - 86_400_000) } : {}),
        },
      });
      matchIds.push(match.id);
      venueIds.push(match.venueId);
      await prisma.matchLineupEntry.createMany({
        data: [
          ...home.map((userId, slot) => ({ matchId: match.id, side: 'HOME' as const, userId, displayNameSnapshot: userId.slice(0, 8), role: 'STARTER' as const, source: 'PARTICIPANT' as const, slotIndex: slot + 1, didNotPlay: Boolean(options.didNotPlay?.includes(userId)) })),
          ...away.map((userId, slot) => ({ matchId: match.id, side: 'AWAY' as const, userId, displayNameSnapshot: userId.slice(0, 8), role: 'STARTER' as const, source: 'PARTICIPANT' as const, slotIndex: slot + 1, didNotPlay: Boolean(options.didNotPlay?.includes(userId)) })),
        ],
      });
      return match;
    },
    async cleanup() {
      await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
      await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      assert((await prisma.user.count({ where: { email: { startsWith: marker } } })) === 0, 'Gate 9 smoke users remained.');
    },
  };
}
