import { Prisma, type AccountStatus } from '../../generated/prisma/client.js';
import type {
  AdminModerationReportQuery,
  AdminModerationUserQuery,
  CreateAccountEnforcementInput,
  CreateModerationReportInput,
  RevokeAccountEnforcementInput,
  UpdateModerationReportInput,
} from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { AppError } from '../../errors/app-error.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';
import { toPublicUser } from '../users/user.mapper.js';
import { appendAdminAudit } from '../admin/admin-audit.js';

const publicUserSelect = {
  id: true,
  email: true,
  username: true,
  createdAt: true,
  accountStatus: true,
  platformRole: true,
  profile: { include: { preferredPositions: true } },
  teamMemberships: {
    include: { team: true },
    orderBy: { joinedAt: 'asc' as const },
  },
} as const;

const actorSelect = {
  id: true,
  email: true,
  username: true,
  createdAt: true,
  profile: { include: { preferredPositions: true } },
  teamMemberships: {
    include: { team: true },
    orderBy: { joinedAt: 'asc' as const },
  },
} as const;

const enforcementInclude = {
  createdByAdmin: { select: actorSelect },
  revokedByAdmin: { select: actorSelect },
} as const;

const reportInclude = {
  reporter: { select: actorSelect },
  assignedAdmin: { select: actorSelect },
} as const;

type EnforcementRow = Prisma.AccountEnforcementGetPayload<{ include: typeof enforcementInclude }>;
type ReportRow = Prisma.ModerationReportGetPayload<{ include: typeof reportInclude }>;

const enforcementDto = (row: EnforcementRow) => ({
  id: row.id,
  userId: row.userId,
  type: row.type,
  status: row.status,
  publicReason: row.publicReason,
  ...(row.internalNote ? { internalNote: row.internalNote } : {}),
  startsAt: row.startsAt.toISOString(),
  ...(row.endsAt ? { endsAt: row.endsAt.toISOString() } : {}),
  ...(row.revokedAt ? { revokedAt: row.revokedAt.toISOString() } : {}),
  createdAt: row.createdAt.toISOString(),
  createdByAdmin: toPublicUser(row.createdByAdmin),
  ...(row.revokedByAdmin ? { revokedByAdmin: toPublicUser(row.revokedByAdmin) } : {}),
});

const reportDto = (row: ReportRow, admin: boolean) => ({
  id: row.id,
  targetType: row.targetType,
  targetId: row.targetId,
  reason: row.reason,
  ...(row.details ? { details: row.details } : {}),
  ...(admin ? { evidenceSnapshot: row.evidenceSnapshot as Record<string, unknown> } : {}),
  status: row.status,
  ...(row.resolutionSummary ? { resolutionSummary: row.resolutionSummary } : {}),
  ...(row.resolvedAt ? { resolvedAt: row.resolvedAt.toISOString() } : {}),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  ...(admin ? { reporter: toPublicUser(row.reporter) } : {}),
  ...(admin && row.assignedAdmin ? { assignedAdmin: toPublicUser(row.assignedAdmin) } : {}),
});

export class ModerationService {
  async createReport(reporterUserId: string, input: CreateModerationReportInput) {
    const evidenceSnapshot = await this.captureEvidence(reporterUserId, input);
    const row = await prisma.moderationReport.create({
      data: { reporterUserId, ...input, evidenceSnapshot },
      include: reportInclude,
    });
    return reportDto(row, false);
  }

  async listMine(reporterUserId: string) {
    const rows = await prisma.moderationReport.findMany({
      where: { reporterUserId },
      include: reportInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => reportDto(row, false));
  }

  async listReports(query: AdminModerationReportQuery, adminUserId: string) {
    const rows = await prisma.moderationReport.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.assignedToMe ? { assignedAdminUserId: adminUserId } : {}),
      },
      include: reportInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((row) => reportDto(row, true));
  }

  async getReport(reportId: string) {
    const row = await prisma.moderationReport.findUnique({ where: { id: reportId }, include: reportInclude });
    if (!row) throw new AppError(404, 'Moderation report not found.', 'MODERATION_REPORT_NOT_FOUND');
    return reportDto(row, true);
  }

  async updateReport(reportId: string, adminUserId: string, input: UpdateModerationReportInput, requestId: string) {
    const row = await prisma.$transaction(async (tx) => {
      const current = await tx.moderationReport.findUnique({ where: { id: reportId } });
      if (!current) throw new AppError(404, 'Moderation report not found.', 'MODERATION_REPORT_NOT_FOUND');
      const terminal = input.status === 'RESOLVED' || input.status === 'DISMISSED';
      const updated = await tx.moderationReport.update({
        where: { id: reportId },
        data: {
          status: input.status,
          ...(input.assignedToMe === true ? { assignedAdminUserId: adminUserId } : {}),
          ...(input.assignedToMe === false ? { assignedAdminUserId: null } : {}),
          resolutionSummary: terminal ? input.resolutionSummary : null,
          resolvedAt: terminal ? new Date() : null,
        },
        include: reportInclude,
      });
      await appendAdminAudit(tx, {
        actorUserId: adminUserId,
        action: 'MODERATION_REPORT_UPDATED',
        entityType: 'MODERATION_REPORT',
        entityId: reportId,
        requestId,
        metadata: { previousStatus: current.status, status: updated.status },
      });
      return updated;
    });
    return reportDto(row, true);
  }

  async listUsers(query: AdminModerationUserQuery) {
    const users = await prisma.user.findMany({
      where: {
        ...(query.accountStatus ? { accountStatus: query.accountStatus } : {}),
        ...(query.search
          ? {
              OR: [
                { email: { contains: query.search, mode: 'insensitive' as const } },
                { username: { contains: query.search, mode: 'insensitive' as const } },
                { profile: { displayName: { contains: query.search, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      select: publicUserSelect,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return users.map((user) => ({
      ...toPublicUser(user),
      email: user.email,
      accountStatus: user.accountStatus,
      platformRole: user.platformRole,
    }));
  }

  async getUser(userId: string) {
    const [user, reportCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          ...publicUserSelect,
          accountEnforcements: { include: enforcementInclude, orderBy: { createdAt: 'desc' } },
        },
      }),
      prisma.moderationReport.count({ where: { targetType: 'USER', targetId: userId } }),
    ]);
    if (!user) throw new AppError(404, 'Player not found.', 'PLAYER_NOT_FOUND');
    const history = user.accountEnforcements.map(enforcementDto);
    return {
      user: {
        ...toPublicUser(user),
        email: user.email,
        accountStatus: user.accountStatus,
        platformRole: user.platformRole,
      },
      activeEnforcement: history.find((item) => item.status === 'ACTIVE'),
      enforcementHistory: history,
      reportCount,
    };
  }

  async enforce(userId: string, adminUserId: string, input: CreateAccountEnforcementInput, requestId: string) {
    const now = new Date();
    const endsAt = input.type === 'SUSPENSION' ? new Date(input.endsAt) : null;
    if (endsAt && endsAt <= now)
      throw new AppError(400, 'Suspension end must be in the future.', 'INVALID_SUSPENSION_END');
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, platformRole: true, accountStatus: true } });
      if (!target) throw new AppError(404, 'Player not found.', 'PLAYER_NOT_FOUND');
      if (target.id === adminUserId || target.platformRole === 'ADMIN')
        throw new AppError(403, 'Administrator accounts cannot be restricted here.', 'ADMIN_ENFORCEMENT_FORBIDDEN');
      const active = await tx.accountEnforcement.findFirst({ where: { userId, status: 'ACTIVE' } });
      if (active) {
        if (input.type !== 'BAN')
          throw new AppError(409, 'This player already has an active enforcement.', 'ENFORCEMENT_ACTIVE');
        await tx.accountEnforcement.update({
          where: { id: active.id },
          data: { status: 'REVOKED', revokedAt: now, revokedByAdminUserId: adminUserId },
        });
      }
      const enforcement = await tx.accountEnforcement.create({
        data: {
          userId,
          type: input.type,
          publicReason: input.publicReason,
          internalNote: input.internalNote,
          endsAt,
          createdByAdminUserId: adminUserId,
        },
      });
      const accountStatus: AccountStatus = input.type === 'BAN' ? 'BANNED' : 'SUSPENDED';
      await tx.user.update({ where: { id: userId }, data: { accountStatus } });
      await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      if (endsAt)
        await enqueueDurableJob(tx, {
          type: 'ACCOUNT_SUSPENSION_EXPIRE',
          dedupeKey: `account-suspension-expire:${enforcement.id}`,
          payload: { enforcementId: enforcement.id },
          runAt: endsAt,
        });
      await appendAdminAudit(tx, {
        actorUserId: adminUserId,
        action: input.type === 'BAN' ? 'PLAYER_BANNED' : 'PLAYER_SUSPENDED',
        entityType: 'USER',
        entityId: userId,
        requestId,
        metadata: { enforcementId: enforcement.id, endsAt: endsAt?.toISOString() ?? null },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    emitDomainEventBestEffort('auth:user-sessions-revoked', { userId });
    return this.getUser(userId);
  }

  async revokeEnforcement(userId: string, enforcementId: string, adminUserId: string, input: RevokeAccountEnforcementInput, requestId: string) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const enforcement = await tx.accountEnforcement.findFirst({ where: { id: enforcementId, userId } });
      if (!enforcement) throw new AppError(404, 'Enforcement not found.', 'ENFORCEMENT_NOT_FOUND');
      if (enforcement.status !== 'ACTIVE')
        throw new AppError(409, 'This enforcement is no longer active.', 'ENFORCEMENT_NOT_ACTIVE');
      const now = new Date();
      await tx.accountEnforcement.update({
        where: { id: enforcementId },
        data: { status: 'REVOKED', revokedAt: now, revokedByAdminUserId: adminUserId },
      });
      await tx.user.update({ where: { id: userId }, data: { accountStatus: 'ACTIVE' } });
      await appendAdminAudit(tx, {
        actorUserId: adminUserId,
        action: 'PLAYER_REINSTATED',
        entityType: 'USER',
        entityId: userId,
        requestId,
        metadata: { enforcementId, reason: input.reason },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    emitDomainEventBestEffort('auth:user-sessions-revoked', { userId });
    return this.getUser(userId);
  }

  async expireSuspension(enforcementId: string, now = new Date()) {
    let userId: string | undefined;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AccountEnforcement" WHERE "id" = ${enforcementId}::uuid FOR UPDATE`;
      const enforcement = await tx.accountEnforcement.findUnique({ where: { id: enforcementId } });
      if (!enforcement || enforcement.status !== 'ACTIVE') return;
      if (enforcement.type !== 'SUSPENSION' || !enforcement.endsAt || enforcement.endsAt > now)
        throw Object.assign(new Error('Suspension is not ready to expire.'), { code: 'ENFORCEMENT_NOT_DUE' });
      userId = enforcement.userId;
      await tx.accountEnforcement.update({ where: { id: enforcementId }, data: { status: 'EXPIRED' } });
      await tx.user.updateMany({ where: { id: enforcement.userId, accountStatus: 'SUSPENDED' }, data: { accountStatus: 'ACTIVE' } });
      await appendAdminAudit(tx, {
        action: 'PLAYER_SUSPENSION_EXPIRED',
        entityType: 'USER',
        entityId: enforcement.userId,
        metadata: { enforcementId },
      });
    });
    if (userId) emitDomainEventBestEffort('auth:user-sessions-revoked', { userId });
  }

  private async captureEvidence(reporterUserId: string, input: CreateModerationReportInput): Promise<Prisma.InputJsonObject> {
    if (input.targetType === 'USER') {
      if (input.targetId === reporterUserId)
        throw new AppError(400, 'You cannot report your own account.', 'REPORT_SELF_NOT_ALLOWED');
      const user = await prisma.user.findUnique({ where: { id: input.targetId }, select: { id: true, username: true, profile: { select: { displayName: true } } } });
      if (!user) throw new AppError(404, 'Report target not found.', 'REPORT_TARGET_NOT_FOUND');
      return { userId: user.id, username: user.username, displayName: user.profile?.displayName ?? user.username };
    }
    if (input.targetType === 'DIRECT_MESSAGE') {
      const message = await prisma.directMessage.findFirst({
        where: { id: input.targetId, conversation: { participants: { some: { userId: reporterUserId } } } },
        select: { id: true, senderId: true, conversationId: true, content: true, createdAt: true, editedAt: true, deletedAt: true },
      });
      if (!message) throw new AppError(404, 'Report target not found.', 'REPORT_TARGET_NOT_FOUND');
      if (message.senderId === reporterUserId)
        throw new AppError(400, 'You cannot report your own message.', 'REPORT_SELF_NOT_ALLOWED');
      return { ...message, createdAt: message.createdAt.toISOString(), editedAt: message.editedAt?.toISOString() ?? null, deletedAt: message.deletedAt?.toISOString() ?? null };
    }
    if (input.targetType === 'LOBBY_MESSAGE') {
      const message = await prisma.lobbyMessage.findFirst({
        where: {
          id: input.targetId,
          match: {
            OR: [
              { createdById: reporterUserId },
              { participants: { some: { userId: reporterUserId, status: 'JOINED' } } },
              { teamSides: { some: { team: { memberships: { some: { userId: reporterUserId } } } } } },
            ],
          },
        },
        select: { id: true, senderId: true, matchId: true, content: true, createdAt: true, editedAt: true, deletedAt: true },
      });
      if (!message) throw new AppError(404, 'Report target not found.', 'REPORT_TARGET_NOT_FOUND');
      if (message.senderId === reporterUserId)
        throw new AppError(400, 'You cannot report your own message.', 'REPORT_SELF_NOT_ALLOWED');
      return { ...message, createdAt: message.createdAt.toISOString(), editedAt: message.editedAt?.toISOString() ?? null, deletedAt: message.deletedAt?.toISOString() ?? null };
    }
    if (input.targetType === 'TEAM') {
      const team = await prisma.team.findUnique({ where: { id: input.targetId }, select: { id: true, name: true, shortName: true, ownerUserId: true } });
      if (!team) throw new AppError(404, 'Report target not found.', 'REPORT_TARGET_NOT_FOUND');
      return team;
    }
    const match = await prisma.match.findUnique({ where: { id: input.targetId }, select: { id: true, name: true, createdById: true, mode: true, status: true, startsAt: true } });
    if (!match) throw new AppError(404, 'Report target not found.', 'REPORT_TARGET_NOT_FOUND');
    return { ...match, startsAt: match.startsAt.toISOString() };
  }
}
