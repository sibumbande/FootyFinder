import type {
  TeamDetail,
  TeamFormation,
  TeamInviteLanding,
  TeamInviteMetadata,
  TeamInviteStatus,
  TeamMember,
  TeamSummary,
} from '@footy-finder/shared';
import { toPublicUser } from '../users/user.mapper.js';

export const inviteStatus = (invite: {
  revokedAt: Date | null;
  expiresAt: Date;
  useCount: number;
  maxUses: number;
}): TeamInviteStatus =>
  invite.revokedAt
    ? 'REVOKED'
    : invite.expiresAt <= new Date()
      ? 'EXPIRED'
      : invite.useCount >= invite.maxUses
        ? 'USED'
        : 'ACTIVE';

export const toTeamMember = (membership: any): TeamMember => ({
  id: membership.id,
  teamId: membership.teamId,
  userId: membership.userId,
  role: membership.role,
  joinedAt: membership.joinedAt.toISOString(),
  user: toPublicUser(membership.user),
});

export const toTeamSummary = (team: any, viewerUserId?: string): TeamSummary => ({
  id: team.id,
  name: team.name,
  shortName: team.shortName,
  profileImageUrl: team.profileImageUrl,
  locationText: team.locationText,
  primaryFormat: team.primaryFormat,
  primaryColor: team.primaryColor,
  secondaryColor: team.secondaryColor,
  memberCount: team._count?.memberships ?? team.memberships?.length ?? 0,
  viewerRole: team.memberships?.find((item: any) => item.userId === viewerUserId)?.role ?? null,
  archivedAt: team.archivedAt ? team.archivedAt.toISOString() : null,
});

export const toTeamDetail = (team: any, viewerUserId?: string): TeamDetail => ({
  ...toTeamSummary(team, viewerUserId),
  description: team.description,
  ownerUserId: team.ownerUserId,
  owner: toPublicUser(team.owner),
  members: team.memberships.map(toTeamMember),
  createdAt: team.createdAt.toISOString(),
  updatedAt: team.updatedAt.toISOString(),
});

export const toTeamInvite = (invite: any, inviteUrl?: string): TeamInviteMetadata => ({
  id: invite.id,
  teamId: invite.teamId,
  createdBy: toPublicUser(invite.createdBy),
  createdAt: invite.createdAt.toISOString(),
  expiresAt: invite.expiresAt.toISOString(),
  revokedAt: invite.revokedAt?.toISOString(),
  maxUses: invite.maxUses,
  useCount: invite.useCount,
  status: inviteStatus(invite),
  inviteUrl,
});

export const toInviteLanding = (invite: any): TeamInviteLanding => ({
  team: { ...toTeamSummary(invite.team), description: invite.team.description },
  invitedBy: toPublicUser(invite.createdBy),
  expiresAt: invite.expiresAt.toISOString(),
  status: inviteStatus(invite),
});

export const toTeamFormation = (formation: any): TeamFormation => ({
  id: formation.id,
  teamId: formation.teamId,
  format: formation.format,
  formationKey: formation.formationKey,
  updatedAt: formation.updatedAt.toISOString(),
  slots: formation.slots.map((slot: any) => ({
    id: slot.id,
    formationId: slot.formationId,
    slotIndex: slot.slotIndex,
    positionX: Number(slot.positionX),
    positionY: Number(slot.positionY),
    membershipId: slot.membershipId,
    member: slot.membership
      ? {
          id: slot.membership.id,
          userId: slot.membership.userId,
          user: toPublicUser(slot.membership.user),
        }
      : null,
  })),
});
