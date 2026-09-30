import {
  getGoNoGoAt,
  getMatchEndsAt,
  refereeWindowsOverlap,
  type AdminRefereeMatch,
  type AdminRefereeMatchQuery,
  type AdminRefereeOption,
  type AdminRefereeSettings,
  type AssignRefereeInput,
  type DeclineRefereeInput,
  type RefereeSettingsInput,
  type RemoveRefereeInput,
} from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { assignRefereeInTx, removeRefereeInTx } from './referee-assignment.js';
import { isActiveReferee } from './referee-status.js';

const person = { select: { id: true, username: true, accountStatus: true, profile: { select: { displayName: true, avatarUrl: true } } } } as const;
const nameOf = (user: { username: string; profile: { displayName: string } | null }) => user.profile?.displayName ?? user.username;

const adminMatchSelect = {
  id: true,
  name: true,
  mode: true,
  format: true,
  status: true,
  startsAt: true,
  durationMinutes: true,
  goNoGoAt: true,
  refereeAssignedAt: true,
  venue: { select: { name: true } },
  referee: { select: { ...person.select, refereeGrants: { where: { revokedAt: null }, select: { id: true }, take: 1 } } },
  refereeAssignments: {
    orderBy: { createdAt: 'desc' as const },
    take: 10,
    select: { id: true, action: true, reason: true, createdAt: true, referee: person, actor: person },
  },
} satisfies Prisma.MatchSelect;

type AdminMatchRow = Prisma.MatchGetPayload<{ select: typeof adminMatchSelect }>;

const toAdminRefereeMatch = (row: AdminMatchRow): AdminRefereeMatch => ({
  matchId: row.id,
  name: row.name,
  mode: row.mode,
  format: row.format,
  status: row.status,
  startsAt: row.startsAt.toISOString(),
  matchEndsAt: getMatchEndsAt(row).toISOString(),
  goNoGoAt: (row.goNoGoAt ?? getGoNoGoAt(row.startsAt)).toISOString(),
  venueName: row.venue.name,
  referee: row.referee
    ? {
        id: row.referee.id,
        displayName: nameOf(row.referee),
        avatarUrl: row.referee.profile?.avatarUrl ?? null,
        accountStatus: row.referee.accountStatus,
        activeReferee: row.referee.accountStatus === 'ACTIVE' && row.referee.refereeGrants.length > 0,
      }
    : null,
  refereeAssignedAt: row.refereeAssignedAt?.toISOString() ?? null,
  history: row.refereeAssignments.map((entry) => ({
    id: entry.id,
    action: entry.action,
    referee: { id: entry.referee.id, displayName: nameOf(entry.referee) },
    actor: entry.actor ? { id: entry.actor.id, displayName: nameOf(entry.actor) } : null,
    reason: entry.reason,
    createdAt: entry.createdAt.toISOString(),
  })),
});

/** Live refereed matches: they have a go/no-go and have not been cancelled, finished or drafted. */
const liveRefereedMatches = (now: Date): Prisma.MatchWhereInput => ({
  goNoGoAt: { not: null },
  status: { in: ['OPEN', 'READY', 'IN_PROGRESS', 'AWAITING_RESULT'] },
  startsAt: { gt: new Date(now.getTime() - 24 * 3_600_000) },
});

const publish = (matchId: string) => emitDomainEventBestEffort('match:updated', { matchId });

/**
 * Gate 8 / TKT-802: admin assignment of referees (with the D27 overlap rule), the D28 default
 * referee setting, and a referee declining an assignment (D16).
 */
export class RefereeAssignmentService {
  async listMatches(query: AdminRefereeMatchQuery, now = new Date()): Promise<AdminRefereeMatch[]> {
    const rows = await prisma.match.findMany({
      where: {
        ...liveRefereedMatches(now),
        ...(query.view === 'unassigned' ? { refereeUserId: null, startsAt: { gt: now } } : {}),
      },
      select: adminMatchSelect,
      orderBy: { startsAt: 'asc' },
      take: 200,
    });
    // An assigned referee whose role or account is no longer active counts as unassigned.
    const matches = rows.map(toAdminRefereeMatch);
    if (query.view !== 'unassigned') return matches;
    const inactive = await prisma.match.findMany({
      where: { ...liveRefereedMatches(now), startsAt: { gt: now }, refereeUserId: { not: null } },
      select: adminMatchSelect,
      orderBy: { startsAt: 'asc' },
      take: 200,
    });
    return [...matches, ...inactive.map(toAdminRefereeMatch).filter(({ referee }) => referee && !referee.activeReferee)]
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  /** D27: every active referee and whether they are free for this match (and if not, the clash). */
  async options(matchId: string): Promise<AdminRefereeOption[]> {
    const match = await prisma.match.findUnique({ where: { id: matchId }, select: { id: true, startsAt: true, durationMinutes: true } });
    if (!match) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
    const [grants, settings] = await Promise.all([
      prisma.refereeGrant.findMany({
        where: { revokedAt: null, user: { accountStatus: 'ACTIVE' } },
        select: { user: person },
        orderBy: { grantedAt: 'asc' },
      }),
      prisma.refereeSettings.findUnique({ where: { id: 1 }, select: { defaultRefereeUserId: true } }),
    ]);
    const others = await prisma.match.findMany({
      where: {
        id: { not: matchId },
        refereeUserId: { in: grants.map(({ user }) => user.id) },
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
        startsAt: { gt: new Date(match.startsAt.getTime() - 24 * 3_600_000), lt: new Date(match.startsAt.getTime() + 24 * 3_600_000) },
      },
      select: { id: true, name: true, startsAt: true, durationMinutes: true, refereeUserId: true },
    });
    return grants.map(({ user }) => {
      const clash = others.find((other) => other.refereeUserId === user.id && refereeWindowsOverlap(other, match));
      return {
        userId: user.id,
        displayName: nameOf(user),
        isDefault: settings?.defaultRefereeUserId === user.id,
        busy: Boolean(clash),
        clash: clash
          ? { matchId: clash.id, name: clash.name, startsAt: clash.startsAt.toISOString(), matchEndsAt: getMatchEndsAt(clash).toISOString() }
          : null,
      };
    });
  }

  async assign(matchId: string, adminUserId: string, input: AssignRefereeInput, requestId: string) {
    await serializableTransaction(async (tx) => {
      const result = await assignRefereeInTx(tx, {
        matchId,
        refereeUserId: input.refereeUserId,
        actorUserId: adminUserId,
        action: 'ASSIGNED',
        reason: input.reason,
      });
      if (result.outcome === 'ASSIGNED')
        await appendAdminAudit(tx, {
          actorUserId: adminUserId,
          action: 'REFEREE_ASSIGNED',
          entityType: 'MATCH',
          entityId: matchId,
          requestId,
          metadata: { refereeUserId: input.refereeUserId, reason: input.reason ?? null },
        });
    });
    publish(matchId);
    return this.getMatch(matchId);
  }

  async remove(matchId: string, adminUserId: string, input: RemoveRefereeInput, requestId: string) {
    await serializableTransaction(async (tx) => {
      const removed = await removeRefereeInTx(tx, { matchId, actorUserId: adminUserId, action: 'REMOVED', reason: input.reason });
      await appendAdminAudit(tx, {
        actorUserId: adminUserId,
        action: 'REFEREE_REMOVED',
        entityType: 'MATCH',
        entityId: matchId,
        requestId,
        metadata: { refereeUserId: removed.refereeUserId, reason: input.reason },
      });
    });
    publish(matchId);
    return this.getMatch(matchId);
  }

  async getMatch(matchId: string) {
    const row = await prisma.match.findUnique({ where: { id: matchId }, select: adminMatchSelect });
    if (!row) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
    return toAdminRefereeMatch(row);
  }

  async getSettings(): Promise<AdminRefereeSettings> {
    const settings = await prisma.refereeSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: { updatedAt: true, defaultReferee: person, updatedBy: person },
    });
    return {
      defaultReferee: settings.defaultReferee ? { userId: settings.defaultReferee.id, displayName: nameOf(settings.defaultReferee) } : null,
      updatedAt: settings.updatedAt.toISOString(),
      updatedBy: settings.updatedBy ? { id: settings.updatedBy.id, displayName: nameOf(settings.updatedBy) } : null,
    };
  }

  /** D28: set or clear the default referee (audited; the route also requires a fresh MFA check). */
  async setSettings(adminUserId: string, input: RefereeSettingsInput, requestId: string) {
    await serializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RefereeSettings" WHERE "id" = 1 FOR UPDATE`;
      if (input.defaultRefereeUserId && !(await isActiveReferee(tx, input.defaultRefereeUserId)))
        throw new AppError(409, 'The default referee must be an active referee.', 'REFEREE_NOT_ACTIVE');
      const before = await tx.refereeSettings.findUniqueOrThrow({ where: { id: 1 }, select: { defaultRefereeUserId: true } });
      await tx.refereeSettings.update({
        where: { id: 1 },
        data: { defaultRefereeUserId: input.defaultRefereeUserId, updatedById: adminUserId, updatedAt: new Date() },
      });
      await appendAdminAudit(tx, {
        actorUserId: adminUserId,
        action: 'DEFAULT_REFEREE_SET',
        entityType: 'REFEREE_SETTINGS',
        entityId: '1',
        requestId,
        metadata: { from: before.defaultRefereeUserId, to: input.defaultRefereeUserId },
      });
    });
    return this.getSettings();
  }

  /** D16: the assigned referee declines, until T-30. The match goes back to unassigned and admins are alerted. */
  async decline(matchId: string, refereeUserId: string, input: DeclineRefereeInput, now = new Date()) {
    await serializableTransaction(async (tx) => {
      const match = await tx.match.findUnique({ where: { id: matchId }, select: { refereeUserId: true, goNoGoAt: true } });
      if (!match || match.refereeUserId !== refereeUserId)
        throw new AppError(404, 'You are not the referee for this match.', 'NOT_MATCH_REFEREE');
      if (match.goNoGoAt && now >= match.goNoGoAt)
        throw new AppError(409, 'You can decline only until 30 minutes before kickoff. Contact FootyFinder.', 'REFEREE_DECLINE_CLOSED');
      await removeRefereeInTx(tx, {
        matchId,
        actorUserId: refereeUserId,
        action: 'DECLINED',
        reason: input.reason ?? 'Declined by the referee',
        expectedRefereeUserId: refereeUserId,
      }, now);
    });
    publish(matchId);
    return { matchId, declined: true as const };
  }
}
