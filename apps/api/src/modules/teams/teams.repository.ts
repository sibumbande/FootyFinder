import { Prisma, type MatchFormat, type TeamRole } from '../../generated/prisma/client.js';
import type {
  CreateTeamInput,
  UpdateTeamFormationSlotInput,
  UpdateTeamInput,
} from '@footy-finder/shared';
import {
  MATCH_FORMATS,
  createFormationPresetSlots,
  getDefaultFormationKey,
} from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import {
  notificationDedupeKey,
  persistNotifications,
} from '../notifications/notification-writer.js';
import { safeUserInclude } from '../users/users.repository.js';
import { formatRands } from '../matches/cancellation-message.js';
import { TeamWalletRepository } from '../team-wallet/team-wallet.repository.js';
import { TeamWalletTransfers } from '../team-wallet/team-wallet.transfers.js';

const memberInclude = { user: { include: safeUserInclude } } as const;
export const teamInclude = {
  owner: { include: safeUserInclude },
  memberships: { include: memberInclude, orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }] },
  _count: { select: { memberships: true } },
} satisfies Prisma.TeamInclude;
const inviteInclude = {
  createdBy: { include: safeUserInclude },
  team: { include: { _count: { select: { memberships: true } } } },
} as const;
const formationInclude = {
  slots: {
    include: { membership: { include: memberInclude } },
    orderBy: { slotIndex: 'asc' as const },
  },
} as const;

export class TeamsRepository {
  constructor(
    private readonly teamWallets = new TeamWalletRepository(),
    private readonly transfers = new TeamWalletTransfers(),
  ) {}

  create(input: CreateTeamInput, ownerUserId: string) {
    return serializableTransaction((tx) =>
      tx.team.create({
        data: {
          name: input.name,
          shortName: input.shortName,
          description: input.description,
          locationText: input.locationText,
          primaryFormat: input.primaryFormat,
          primaryColor: input.primaryColor,
          secondaryColor: input.secondaryColor,
          owner: { connect: { id: ownerUserId } },
          memberships: { create: { userId: ownerUserId, role: 'OWNER' } },
          formations: {
            create: MATCH_FORMATS.map((format) => {
              const formationKey =
                format === input.primaryFormat
                  ? input.formationKey
                  : getDefaultFormationKey(format);
              return {
                format,
                formationKey,
                slots: { create: createFormationPresetSlots(format, formationKey) },
              };
            }),
          },
        },
        include: teamInclude,
      }),
    );
  }

  listForUser(userId: string) {
    return prisma.team.findMany({
      where: { memberships: { some: { userId } }, archivedAt: null },
      include: teamInclude,
      orderBy: { updatedAt: 'desc' },
    });
  }
  findById(id: string) {
    return prisma.team.findUnique({ where: { id }, include: teamInclude });
  }
  findByShortName(shortName: string, excludingTeamId?: string) {
    return prisma.team.findFirst({
      where: { shortName, id: excludingTeamId ? { not: excludingTeamId } : undefined },
      select: { id: true },
    });
  }
  findMembership(teamId: string, userId: string) {
    return prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId } },
      include: memberInclude,
    });
  }
  update(id: string, input: UpdateTeamInput & { profileImageUrl?: string | null }) {
    return prisma.team.update({ where: { id }, data: input, include: teamInclude });
  }
  /**
   * Gate 7 / D7: closing a team archives it; it is never deleted, so its money history is kept.
   * Blocked while fill-meter money is held or a public team match is still upcoming or running.
   * Every contributor's own unspent contributions go back to their personal wallet (no cash-out),
   * the team's private planning drafts are cancelled and its open invitations revoked.
   */
  close(id: string, actorUserId: string) {
    return serializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const team = await tx.team.findUniqueOrThrow({ where: { id } });
      if (team.archivedAt) return { outcome: 'ALREADY_CLOSED' as const, refunds: [], notifications: [] };
      const blockingMatches = await tx.match.count({
        where: {
          teamSides: { some: { teamId: id } },
          visibility: 'PUBLIC',
          status: { in: ['OPEN', 'READY', 'IN_PROGRESS', 'AWAITING_RESULT'] },
        },
      });
      if (blockingMatches) return { outcome: 'UPCOMING_MATCHES' as const, refunds: [], notifications: [] };
      const account = await this.teamWallets.lockAccount(tx, id);
      if (await this.teamWallets.heldCents(tx, account.id))
        return { outcome: 'HOLDS_ACTIVE' as const, refunds: [], notifications: [] };
      const refunds: Array<{ userId: string; amountCents: number }> = [];
      for (const [contributorUserId, amountCents] of await this.teamWallets.unspentByContributor(tx, account.id)) {
        await this.transfers.refundContributor(tx, {
          teamId: id,
          teamName: team.name,
          contributorUserId,
          amountCents,
          type: 'CLOSURE_REFUND_DEBIT',
          idempotencyKey: `team-closure:${id}:${contributorUserId}`,
          actorUserId,
        });
        refunds.push({ userId: contributorUserId, amountCents });
      }
      const now = new Date();
      await tx.match.updateMany({
        where: {
          teamSides: { some: { teamId: id } },
          visibility: 'PRIVATE',
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      await tx.teamInvite.updateMany({ where: { teamId: id, revokedAt: null }, data: { revokedAt: now } });
      await tx.team.update({ where: { id }, data: { archivedAt: now, shortName: null } });
      const notifications = await persistNotifications(
        tx,
        refunds.map(({ userId, amountCents }) => ({
          userId,
          type: 'WALLET_CREDIT' as const,
          title: 'Team contributions returned',
          message: `${team.name} was closed. Your unspent ${formatRands(amountCents)} was returned to your FootyFinder wallet.`,
          targetPath: '/wallet',
          dedupeKey: notificationDedupeKey('team', id, 'closure-refund', userId),
        })),
      );
      return { outcome: 'CLOSED' as const, refunds, notifications };
    });
  }
  updateMemberRole(teamId: string, userId: string, role: Exclude<TeamRole, 'OWNER'>) {
    return prisma.teamMembership.update({
      where: { teamId_userId: { teamId, userId } },
      data: { role },
      include: memberInclude,
    });
  }
  async removeMember(teamId: string, userId: string) {
    return serializableTransaction(async (tx) => {
      await tx.teamFormationSlot.updateMany({
        where: { membership: { teamId, userId } },
        data: { membershipId: null },
      });
      return tx.teamMembership.delete({ where: { teamId_userId: { teamId, userId } } });
    });
  }

  createInvite(teamId: string, createdByUserId: string, tokenHash: string, expiresAt: Date) {
    return prisma.teamInvite.create({
      data: { teamId, createdByUserId, tokenHash, expiresAt, maxUses: 1 },
      include: inviteInclude,
    });
  }
  listInvites(teamId: string) {
    return prisma.teamInvite.findMany({
      where: { teamId },
      include: inviteInclude,
      orderBy: { createdAt: 'desc' },
    });
  }
  findInviteByHash(tokenHash: string) {
    return prisma.teamInvite.findUnique({ where: { tokenHash }, include: inviteInclude });
  }
  revokeInvite(id: string, teamId: string) {
    return prisma.teamInvite.updateMany({
      where: { id, teamId, revokedAt: null, useCount: { lt: 1 } },
      data: { revokedAt: new Date() },
    });
  }
  acceptInvite(tokenHash: string, userId: string, now: Date) {
    return serializableTransaction(async (tx) => {
      const invite = await tx.teamInvite.findUnique({
        where: { tokenHash },
        include: { team: true },
      });
      if (!invite) return { outcome: 'INVALID' as const };
      const existing = await tx.teamMembership.findUnique({
        where: { teamId_userId: { teamId: invite.teamId, userId } },
        include: memberInclude,
      });
      if (existing)
        return {
          outcome: 'ALREADY_MEMBER' as const,
          invite,
          membership: existing,
          team: await tx.team.findUniqueOrThrow({
            where: { id: invite.teamId },
            include: teamInclude,
          }),
          notifications: [],
        };
      if (invite.revokedAt) return { outcome: 'REVOKED' as const };
      if (invite.expiresAt <= now) return { outcome: 'EXPIRED' as const };
      const consumed = await tx.teamInvite.updateMany({
        where: {
          id: invite.id,
          revokedAt: null,
          expiresAt: { gt: now },
          useCount: { lt: invite.maxUses },
        },
        data: { useCount: { increment: 1 } },
      });
      if (consumed.count !== 1) return { outcome: 'USED' as const };
      const membership = await tx.teamMembership.create({
        data: { teamId: invite.teamId, userId, role: 'MEMBER' },
        include: memberInclude,
      });
      const team = await tx.team.findUniqueOrThrow({
        where: { id: invite.teamId },
        include: teamInclude,
      });
      const notifications = await persistNotifications(
        tx,
        team.memberships
          .filter(
            ({ userId: adminId, role }) =>
              adminId !== userId && (role === 'OWNER' || role === 'CAPTAIN'),
          )
          .map(({ userId: adminId }) => ({
            userId: adminId,
            type: 'TEAM_MEMBER_JOINED' as const,
            title: 'New team member',
            message: `${membership.user.profile?.displayName ?? membership.user.username} joined ${team.name}.`,
            targetPath: `/teams/${team.id}`,
            dedupeKey: notificationDedupeKey('team-invite', invite.id, 'accepted', userId, adminId),
          })),
      );
      return { outcome: 'JOINED' as const, invite, membership, team, notifications };
    });
  }

  findFormation(teamId: string, format: MatchFormat) {
    return prisma.teamFormation.findUnique({
      where: { teamId_format: { teamId, format } },
      include: formationInclude,
    });
  }
  replaceFormation(teamId: string, format: MatchFormat, formationKey: string) {
    return serializableTransaction(async (tx) => {
      const formation = await tx.teamFormation.findUniqueOrThrow({
        where: { teamId_format: { teamId, format } },
        include: { slots: true },
      });
      const assigned = formation.slots
        .sort((a, b) => a.slotIndex - b.slotIndex)
        .map(({ membershipId }) => membershipId);
      await tx.teamFormationSlot.deleteMany({ where: { formationId: formation.id } });
      await tx.teamFormation.update({
        where: { id: formation.id },
        data: {
          formationKey,
          slots: {
            create: createFormationPresetSlots(format, formationKey).map((slot, index) => ({
              ...slot,
              membershipId: assigned[index] ?? null,
            })),
          },
        },
      });
      return tx.teamFormation.findUniqueOrThrow({
        where: { id: formation.id },
        include: formationInclude,
      });
    });
  }
  updateFormationSlot(
    teamId: string,
    format: MatchFormat,
    slotId: string,
    input: UpdateTeamFormationSlotInput,
  ) {
    return serializableTransaction(async (tx) => {
      const formation = await tx.teamFormation.findUniqueOrThrow({
        where: { teamId_format: { teamId, format } },
      });
      const slot = await tx.teamFormationSlot.findFirstOrThrow({
        where: { id: slotId, formationId: formation.id },
      });
      if (input.membershipId) {
        const member = await tx.teamMembership.findFirst({
          where: { id: input.membershipId, teamId },
        });
        if (!member) throw new Error('TEAM_MEMBER_NOT_FOUND');
        const source = await tx.teamFormationSlot.findFirst({
          where: { formationId: formation.id, membershipId: input.membershipId },
        });
        const targetMembershipId = slot.membershipId;
        if (source)
          await tx.teamFormationSlot.update({
            where: { id: source.id },
            data: { membershipId: null },
          });
        if (targetMembershipId)
          await tx.teamFormationSlot.update({
            where: { id: slot.id },
            data: { membershipId: null },
          });
        await tx.teamFormationSlot.update({
          where: { id: slot.id },
          data: { membershipId: input.membershipId },
        });
        if (source && targetMembershipId)
          await tx.teamFormationSlot.update({
            where: { id: source.id },
            data: { membershipId: targetMembershipId },
          });
      }
      await tx.teamFormationSlot.update({
        where: { id: slot.id },
        data: {
          membershipId: input.membershipId === null ? null : undefined,
          positionX: input.positionX,
          positionY: input.positionY,
        },
      });
      return tx.teamFormation.findUniqueOrThrow({
        where: { id: formation.id },
        include: formationInclude,
      });
    });
  }
}
