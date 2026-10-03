import { getDefaultFormationKey, type MatchFormat } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { TeamsRepository } from '../src/modules/teams/teams.repository.js';
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
  const teams = new TeamsRepository();
  const userIds: string[] = [];
  const teamIds: string[] = [];
  const matchIds: string[] = [];
  let venueId = '';
  let fieldId = '';
  let kickoffIndex = 0;
  let userIndex = 0;

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
    async user(label: string) {
      // Reserved synchronously so concurrent calls never share an index.
      const index = userIndex++;
      const created = await prisma.user.create({
        data: {
          email: `${marker}-${index}@smoke.invalid`,
          username: `g7_${marker.slice(-10)}_${index}`,
          passwordHash: 'smoke-test-only',
          emailVerifiedAt: new Date(),
          onboardingCompletedAt: new Date(),
          profile: { create: { displayName: label, onboardingStatus: 'COMPLETE', gender: 'MALE' } },
        },
      });
      userIds.push(created.id);
      return created;
    },
    async venue() {
      const priceFrom = new Date(Date.now() - 86_400_000);
      const submitter = await world.user('Venue submitter');
      const approver = await world.user('Venue approver');
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
    async cleanup() {
      const allMatchIds = [
        ...new Set([
          ...matchIds,
          ...(await prisma.match.findMany({ where: { name: { startsWith: marker } }, select: { id: true } })).map(({ id }) => id),
        ]),
      ];
      if (allMatchIds.length)
        await prisma.durableJob.deleteMany({ where: { OR: allMatchIds.map((id) => ({ dedupeKey: { contains: id } })) } });
      await prisma.teamMatchAuditEvent.deleteMany({ where: { OR: [{ matchId: { in: allMatchIds } }, { teamId: { in: teamIds } }] } });
      await prisma.teamMessage.deleteMany({ where: { teamId: { in: teamIds } } });
      await deleteTeamWalletFixtures(teamIds);
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      // DEC-021: ticket rows (refunds first; tickets and checkouts restrict match deletion).
      const checkouts = await prisma.ticketCheckout.findMany({ where: { matchId: { in: allMatchIds } }, select: { providerPaymentId: true } });
      await prisma.ticketEmail.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.providerRefund.deleteMany({ where: { ticket: { matchId: { in: allMatchIds } } } });
      await prisma.matchTicket.deleteMany({ where: { matchId: { in: allMatchIds } } });
      await prisma.ticketCheckout.deleteMany({ where: { matchId: { in: allMatchIds } } });
      await prisma.providerPayment.deleteMany({ where: { id: { in: checkouts.flatMap(({ providerPaymentId }) => (providerPaymentId ? [providerPaymentId] : [])) } } });
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
