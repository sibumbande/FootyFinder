import { getDefaultFormationKey, type MatchFormat } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { serializableTransaction } from '../src/database/transaction.js';
import { TeamWalletService } from '../src/modules/team-wallet/team-wallet.service.js';
import { TeamsRepository } from '../src/modules/teams/teams.repository.js';
import { FinancialRepository } from '../src/modules/wallet/financial.repository.js';
import { WalletReconciliationService } from '../src/modules/wallet/wallet-reconciliation.service.js';
import { deleteTeamWalletFixtures } from './team-wallet-fixtures.js';

/**
 * Gate 7 smoke fixtures on a disposable database: funded players, one published managed venue
 * (5/7/11-a-side with admin-only format-scoped costs), teams with saved formations, and a
 * marker-scoped cleanup of everything they create.
 */
export const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
export const rejectsWith = async (work: () => Promise<unknown>, code: string) => {
  try {
    await work();
  } catch (error) {
    return (error as { code?: string }).code === code;
  }
  return false;
};

export function teamMatchWorld(marker: string) {
  const financial = new FinancialRepository();
  const teams = new TeamsRepository();
  const teamWallet = new TeamWalletService();
  const userIds: string[] = [];
  const teamIds: string[] = [];
  const matchIds: string[] = [];
  let venueId = '';
  let fieldId = '';
  let kickoffIndex = 0;

  const world = {
    marker,
    userIds,
    teamIds,
    matchIds,
    get fieldId() {
      return fieldId;
    },
    /** 12:00 Johannesburg on a distinct day per call, 3+ days ahead (a valid 30-minute slot). */
    nextKickoff() {
      const day = new Date(Date.now() + (3 + kickoffIndex++) * 86_400_000);
      day.setUTCHours(10, 0, 0, 0);
      return day;
    },
    async user(label: string, depositCents = 200_000) {
      const index = userIds.length;
      const created = await prisma.user.create({
        data: {
          email: `${marker}-${index}@smoke.invalid`,
          username: `g7_${marker.slice(-10)}_${index}`,
          passwordHash: 'smoke-test-only',
          profile: { create: { displayName: label } },
          walletAccount: { create: {} },
        },
      });
      userIds.push(created.id);
      if (depositCents)
        await serializableTransaction((tx) => financial.credit(tx, {
          userId: created.id, amountCents: depositCents, type: 'DEPOSIT_CREDIT',
          idempotencyKey: `${marker}:seed:${index}`, referenceType: 'SMOKE', referenceId: marker,
        }));
      return created;
    },
    async venue() {
      const priceFrom = new Date(Date.now() - 86_400_000);
      const submitter = await world.user('Venue submitter', 0);
      const approver = await world.user('Venue approver', 0);
      const created = await prisma.managedVenue.create({
        data: {
          slug: `${marker}-venue`, name: `${marker} Park`, addressLine1: '1 Team Road', city: 'Cape Town', region: 'Western Cape', countryCode: 'ZA',
          fields: {
            create: {
              name: 'Main Pitch',
              supportedFormats: { create: [{ format: 'FIVE_A_SIDE' }, { format: 'SEVEN_A_SIDE' }, { format: 'ELEVEN_A_SIDE' }] },
              availabilityPeriods: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 })) },
              prices: { create: [
                { amountCents: 50_000, format: 'FIVE_A_SIDE', effectiveFrom: priceFrom },
                { amountCents: 60_000, format: 'SEVEN_A_SIDE', effectiveFrom: priceFrom },
                { amountCents: 100_000, format: 'ELEVEN_A_SIDE', effectiveFrom: priceFrom },
              ] },
            },
          },
          cancellationPolicies: { create: { effectiveFrom: priceFrom, policyText: 'Full credit more than 24 hours before kickoff.' } },
        },
        include: { fields: true },
      });
      venueId = created.id;
      fieldId = created.fields[0]!.id;
      await prisma.managedVenue.update({
        where: { id: venueId },
        data: { publicationStatus: 'PUBLISHED', submittedByUserId: submitter.id, submittedAt: new Date(), approvedByUserId: approver.id, approvedAt: new Date() },
      });
      return fieldId;
    },
    /** A team owned by `ownerId`; extra members join with the given roles. */
    async team(name: string, ownerId: string, members: Array<{ userId: string; role: 'CAPTAIN' | 'MEMBER' }> = [], format: MatchFormat = 'FIVE_A_SIDE') {
      const team = await teams.create({ name: `${marker}-${name}`, primaryFormat: format, formationKey: getDefaultFormationKey(format) }, ownerId);
      teamIds.push(team.id);
      if (members.length) await prisma.teamMembership.createMany({ data: members.map((member) => ({ teamId: team.id, ...member })) });
      return team;
    },
    contribute: (teamId: string, userId: string, amountCents: number, key: string) =>
      teamWallet.contribute(teamId, userId, amountCents, `${marker}:${key}`),
    /** Reconciliation issues that concern this run's own fixtures. */
    async ourIssues() {
      const report = await new WalletReconciliationService().report();
      return report.issues.filter((issue) =>
        (issue.userId && userIds.includes(issue.userId))
        || (issue.referenceId && (teamIds.includes(issue.referenceId) || matchIds.includes(issue.referenceId))));
    },
    async cleanup() {
      const allMatchIds = [
        ...new Set([
          ...matchIds,
          ...(await prisma.match.findMany({ where: { name: { startsWith: marker } }, select: { id: true } })).map(({ id }) => id),
        ]),
      ];
      if (allMatchIds.length)
        await prisma.durableJob.deleteMany({ where: { OR: allMatchIds.map((id) => ({ dedupeKey: { contains: id } })) } });
      await deleteTeamWalletFixtures(teamIds);
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.venuePayable.deleteMany({ where: { matchId: { in: allMatchIds } } });
      await prisma.fieldReservation.deleteMany({ where: { matchId: { in: allMatchIds } } });
      const venueRows = await prisma.match.findMany({ where: { id: { in: allMatchIds } }, select: { venueId: true } });
      await prisma.match.deleteMany({ where: { id: { in: allMatchIds } } });
      await prisma.venue.deleteMany({ where: { id: { in: venueRows.map(({ venueId: id }) => id) } } });
      await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
      await prisma.walletHold.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
      await prisma.walletTransaction.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
      if (venueId) {
        await prisma.managedFieldPrice.deleteMany({ where: { field: { venueId } } });
        await prisma.venueCancellationPolicy.deleteMany({ where: { venueId } });
        await prisma.managedField.deleteMany({ where: { venueId } });
        await prisma.managedVenue.update({ where: { id: venueId }, data: { publicationStatus: 'DRAFT', submittedByUserId: null, submittedAt: null, approvedByUserId: null, approvedAt: null } });
        await prisma.managedVenue.delete({ where: { id: venueId } });
      }
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      assert((await prisma.user.count({ where: { email: { startsWith: marker } } })) === 0, 'Gate 7 smoke users remained.');
    },
  };
  return world;
}
