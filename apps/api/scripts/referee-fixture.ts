import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { TestEmailProvider } from '../src/modules/auth/email.provider.js';
import { RefereeJobs, registerRefereeJobHandlers } from '../src/modules/referees/referee.jobs.js';

let handlersRegistered = false;
/** Publishing a match queues referee alert jobs; smokes that run the queue need their handlers. */
export function registerRefereeJobsForSmoke() {
  if (handlersRegistered) return;
  handlersRegistered = true;
  registerRefereeJobHandlers(new RefereeJobs(undefined, new TestEmailProvider()));
}

/**
 * Gate 8 (DEC-020): since every match needs an active FootyFinder referee to pass the T-30
 * go/no-go, smokes that expect a match to be confirmed assign this fixture's referee first.
 * `assign` writes the match row directly (fixture setup, not the admin flow), so the D27 overlap
 * rule does not apply here; smoke:referees tests that rule through the real service.
 */
export function refereeFixture(marker: string) {
  let userId = '';
  return {
    get userId() {
      return userId;
    },
    async create() {
      registerRefereeJobsForSmoke();
      const user = await prisma.user.create({
        data: {
          email: `${marker}-referee@smoke.invalid`,
          username: `ref_${randomUUID().slice(0, 12)}`,
          passwordHash: 'smoke-test-only',
          emailVerifiedAt: new Date(),
          onboardingCompletedAt: new Date(),
          profile: { create: { displayName: `Referee ${marker.slice(-4)}` } },
          refereeGrants: { create: { grantReason: 'Smoke fixture referee' } },
        },
      });
      userId = user.id;
      return userId;
    },
    async assign(matchId: string) {
      if (!userId) await this.create();
      await prisma.match.update({ where: { id: matchId }, data: { refereeUserId: userId, refereeAssignedAt: new Date() } });
    },
    /** Removes the referee jobs for these matches; call before deleting the matches. */
    async cleanupJobs(matchIds: string[]) {
      if (!matchIds.length) return;
      await prisma.durableJob.deleteMany({
        where: { OR: matchIds.map((id) => ({ dedupeKey: { startsWith: `referee-unassigned-alert:${id}:` } })) },
      });
    },
    /** Removes the referee unless a retained match still names them; call after the matches are gone. */
    async cleanup() {
      if (!userId || (await prisma.match.count({ where: { refereeUserId: userId } }))) return;
      await prisma.matchRefereeAssignment.deleteMany({ where: { refereeUserId: userId } });
      await prisma.notification.deleteMany({ where: { userId } });
      await prisma.refereeGrant.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    },
  };
}
