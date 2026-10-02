import {
  Prisma,
  type TeamMatchAvailabilityStatus,
  type TeamSide,
} from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import {
  notificationDedupeKey,
  persistNotifications,
} from '../notifications/notification-writer.js';
import { safeUserInclude } from '../users/users.repository.js';
import { ineligibleForGirlsOnly } from '../matches/girls-only.js';

export class TeamMatchSideNotFoundError extends Error {}
export class TeamAvailabilityForbiddenError extends Error {}
export class TeamMatchClosedError extends Error {}
export class AvailabilityNotRequestedError extends Error {}

const availabilityInclude = {
  user: { include: safeUserInclude },
} satisfies Prisma.TeamMatchAvailabilityInclude;

export type TeamMatchAvailabilityRecord = Prisma.TeamMatchAvailabilityGetPayload<{
  include: typeof availabilityInclude;
}>;

const contextInclude = (userId: string) =>
  ({
    match: { select: { mode: true, status: true } },
    team: {
      select: {
        id: true,
        memberships: { where: { userId }, select: { userId: true, role: true } },
      },
    },
  }) satisfies Prisma.MatchTeamInclude;

export class MatchAvailabilityRepository {
  findContext(matchId: string, side: TeamSide, userId: string) {
    return prisma.matchTeam.findUnique({
      where: { matchId_side: { matchId, side } },
      include: contextInclude(userId),
    });
  }

  listForSide(matchTeamId: string) {
    return prisma.teamMatchAvailability.findMany({
      where: { matchTeamId },
      include: availabilityInclude,
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
    });
  }

  listSelectionStatuses(matchTeamId: string) {
    return prisma.teamMatchSelection.findMany({
      where: { matchTeamId },
      select: { userId: true, status: true },
    });
  }

  request(matchId: string, side: TeamSide, userId: string) {
    return serializableTransaction(async (tx) => {
      const initial = await tx.matchTeam.findUnique({
        where: { matchId_side: { matchId, side } },
        select: { id: true },
      });
      if (!initial) throw new TeamMatchSideNotFoundError();

      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "MatchTeam" WHERE "id" = ${initial.id}::uuid FOR UPDATE`,
      );

      const matchTeam = await tx.matchTeam.findUniqueOrThrow({
        where: { id: initial.id },
        include: {
          match: { select: { id: true, name: true, mode: true, status: true, girlsOnly: true } },
          team: {
            select: {
              id: true,
              memberships: {
                select: { userId: true, role: true },
                orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }],
              },
            },
          },
        },
      });
      if (matchTeam.match.mode !== 'TEAM_MATCH' || !matchTeam.team)
        throw new TeamMatchSideNotFoundError();
      if (['CANCELLED', 'COMPLETED'].includes(matchTeam.match.status))
        throw new TeamMatchClosedError();
      const requester = matchTeam.team.memberships.find((member) => member.userId === userId);
      if (!requester || !['OWNER', 'CAPTAIN'].includes(requester.role))
        throw new TeamAvailabilityForbiddenError();

      const existing = await tx.teamMatchAvailability.findMany({
        where: { matchTeamId: matchTeam.id },
        select: { userId: true },
      });
      const existingUserIds = new Set(existing.map((row) => row.userId));
      // CEO touch-up batch 4, item 1 (D2): a girls-only match asks only the members who can play in it.
      const ineligible = matchTeam.match.girlsOnly
        ? await ineligibleForGirlsOnly(tx, matchTeam.team.memberships.map((member) => member.userId))
        : new Set<string>();
      const missing = matchTeam.team.memberships.filter(
        (member) => !existingUserIds.has(member.userId) && !ineligible.has(member.userId),
      );
      if (missing.length) {
        await tx.teamMatchAvailability.createMany({
          data: missing.map((member) => ({
            matchTeamId: matchTeam.id,
            userId: member.userId,
            status: 'NO_RESPONSE',
          })),
        });
      }

      const requestedAt = new Date();
      await tx.matchTeam.update({
        where: { id: matchTeam.id },
        data: { availabilityRequestedAt: requestedAt },
      });

      const notifications = await persistNotifications(
        tx,
        missing
          .filter((member) => member.userId !== userId)
          .map((member) => ({
            userId: member.userId,
            type: 'TEAM_MATCH_AVAILABILITY_REQUESTED' as const,
            title: 'Match availability requested',
            message: `${matchTeam.teamNameSnapshot} needs your availability for ${matchTeam.match.name}.`,
            targetPath: `/matches/${matchId}`,
            dedupeKey: notificationDedupeKey(
              'team-match',
              matchTeam.id,
              'availability-requested',
              member.userId,
            ),
          })),
      );

      return {
        requestedAt,
        addedMemberCount: missing.length,
        notifiedMemberCount: notifications.length,
        notifications,
      };
    });
  }

  updateMine(matchId: string, side: TeamSide, userId: string, status: TeamMatchAvailabilityStatus) {
    return serializableTransaction(async (tx) => {
      const matchTeam = await tx.matchTeam.findUnique({
        where: { matchId_side: { matchId, side } },
        include: contextInclude(userId),
      });
      if (matchTeam?.match.mode !== 'TEAM_MATCH' || !matchTeam.team)
        throw new TeamMatchSideNotFoundError();
      if (['CANCELLED', 'COMPLETED'].includes(matchTeam.match.status))
        throw new TeamMatchClosedError();
      if (!matchTeam.team.memberships.length) throw new TeamAvailabilityForbiddenError();
      const existing = await tx.teamMatchAvailability.findUnique({
        where: { matchTeamId_userId: { matchTeamId: matchTeam.id, userId } },
        select: { id: true },
      });
      if (!existing) throw new AvailabilityNotRequestedError();
      return tx.teamMatchAvailability.update({
        where: { id: existing.id },
        data: {
          status,
          respondedAt: status === 'NO_RESPONSE' ? null : new Date(),
        },
        include: availabilityInclude,
      });
    });
  }
}
