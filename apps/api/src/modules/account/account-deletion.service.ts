import type { AccountDeletionPreview, ConfirmAccountDeletionInput } from '@footy-finder/shared';
import argon2 from 'argon2';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';
import { logError } from '../../observability/logger.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { createEmailProvider, type EmailProvider } from '../auth/email.provider.js';
import { MatchesService } from '../matches/matches.service.js';
import { TicketLeaveService } from '../tickets/ticket-leave.service.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { buildDeletionPreview } from './account-deletion.preview.js';

export const ACCOUNT_DELETION_FINALISE_JOB = 'ACCOUNT_DELETION_FINALISE';
const ACTIVE_SELECTIONS = ['INVITED', 'SELECTED_STARTER', 'SELECTED_SUBSTITUTE', 'OPEN_SLOT_CLAIMED'] as const;

export const formatDeletionDate = (date: Date) =>
  date.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'long', timeStyle: 'short' });
const appUrl = (path: string) => `${env.CLIENT_URL.replace(/\/$/, '')}${path}`;

export const finaliseJobInput = (requestId: string, runAt: Date, attempt = 0) => ({
  type: ACCOUNT_DELETION_FINALISE_JOB,
  dedupeKey: `account-deletion-finalise:${requestId}:${attempt}`,
  payload: { requestId, attempt },
  runAt,
});

/**
 * D4: on confirm the player leaves the squads of upcoming Team Matches (before the 30-minute lock).
 * The Owner and Captains are told a player left, without the player's name.
 */
async function leaveTeamSquads(tx: Prisma.TransactionClient, userId: string, now: Date) {
  const selections = await tx.teamMatchSelection.findMany({
    where: {
      userId,
      status: { in: [...ACTIVE_SELECTIONS] },
      matchTeam: { match: { status: { notIn: ['COMPLETED', 'CANCELLED'] }, startsAt: { gt: now } } },
    },
    select: {
      id: true,
      matchTeam: {
        select: { id: true, teamId: true, lineupFinalizedAt: true, match: { select: { id: true, name: true, goNoGoAt: true } } },
      },
    },
  });
  const drafts = [];
  for (const selection of selections) {
    const { match } = selection.matchTeam;
    if (match.goNoGoAt && now >= match.goNoGoAt) continue; // the preview blocks this; never touch a locked lineup
    await tx.teamMatchLineupSlot.updateMany({ where: { selectionId: selection.id }, data: { selectionId: null } });
    await tx.teamMatchSelection.update({ where: { id: selection.id }, data: { status: 'REMOVED', selectedByUserId: null } });
    if (selection.matchTeam.lineupFinalizedAt)
      await tx.matchTeam.update({ where: { id: selection.matchTeam.id }, data: { lineupFinalizedAt: null } });
    if (!selection.matchTeam.teamId) continue;
    const managers = await tx.teamMembership.findMany({
      where: { teamId: selection.matchTeam.teamId, role: { in: ['OWNER', 'CAPTAIN'] }, userId: { not: userId } },
      select: { userId: true },
    });
    drafts.push(...managers.map((manager) => ({
      userId: manager.userId,
      type: 'TEAM_MATCH_SELECTION_UPDATED' as const,
      title: 'A player left the squad',
      message: `A player closed their FootyFinder account and was taken out of the lineup for ${match.name}. Pick a replacement before the lineup locks.`,
      targetPath: `/matches/${match.id}`,
      dedupeKey: notificationDedupeKey('account-deletion-squad', selection.id, manager.userId),
    })));
  }
  return persistNotifications(tx, drafts);
}

export class AccountDeletionService {
  constructor(
    private readonly emails: EmailProvider = createEmailProvider(),
    private readonly matches = new MatchesService(),
    private readonly tickets = new TicketLeaveService(),
    private readonly notifications = new NotificationsService(),
  ) {}

  preview(userId: string): Promise<AccountDeletionPreview> {
    return serializableTransaction((tx) => buildDeletionPreview(tx, userId));
  }

  async request(userId: string, input: ConfirmAccountDeletionInput, requestId?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, email: true } });
    if (!user || !(await argon2.verify(user.passwordHash, input.password)))
      throw new AppError(401, 'Your password is incorrect.', 'CURRENT_PASSWORD_INVALID');
    const now = new Date();
    const outcome = await serializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const current = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { accountStatus: true } });
      if (current.accountStatus === 'PENDING_DELETION' || current.accountStatus === 'DELETED')
        return { kind: 'ALREADY' as const };
      const preview = await buildDeletionPreview(tx, userId, now);
      if (!preview.canDelete) return { kind: 'BLOCKED' as const, preview };
      await tx.accountDeletionRequest.deleteMany({ where: { userId, status: 'BLOCKED' } });
      const scheduledFor = new Date(preview.scheduledFor);
      const request = await tx.accountDeletionRequest.create({
        data: {
          userId,
          status: 'GRACE',
          requestedAt: now,
          scheduledFor,
          confirmSummary: { matches: preview.matches, teams: preview.teams, credits: preview.credits } as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.user.update({ where: { id: userId }, data: { accountStatus: 'PENDING_DELETION' } });
      await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      // D4: switched off or withdrawn now; friends, blocks, memberships and messages are kept but hidden.
      await tx.playerLookingCard.updateMany({ where: { userId, enabled: true }, data: { enabled: false } });
      await tx.teamJoinRequest.updateMany({ where: { userId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: now } });
      const notifications = await leaveTeamSquads(tx, userId, now);
      await enqueueDurableJob(tx, finaliseJobInput(request.id, scheduledFor));
      await appendAdminAudit(tx, {
        actorUserId: userId,
        action: 'ACCOUNT_DELETION_REQUESTED',
        entityType: 'USER',
        entityId: userId,
        requestId,
        metadata: { deletionRequestId: request.id, scheduledFor: preview.scheduledFor },
      });
      return { kind: 'SCHEDULED' as const, preview, scheduledFor, notifications };
    });

    if (outcome.kind === 'ALREADY')
      throw new AppError(409, 'This account is already being deleted.', 'ACCOUNT_DELETION_PENDING');
    if (outcome.kind === 'BLOCKED') {
      await this.recordBlocked(userId, outcome.preview);
      throw new AppError(409, 'Your account cannot be deleted yet. See the reasons on the summary.', 'ACCOUNT_DELETION_BLOCKED', {
        blockers: outcome.preview.blockers,
      });
    }
    emitDomainEventBestEffort('auth:user-sessions-revoked', { userId });
    this.notifications.publishPersistedMany(outcome.notifications);
    await this.applyMatchPlans(userId, outcome.preview);
    await this.sendEmail(user.email, 'We have received your request to delete your FootyFinder account', [
      'You asked us to delete your FootyFinder account. It is now deactivated and hidden from other players.',
      `Your account will be deleted on ${formatDeletionDate(outcome.scheduledFor)}. Until then you can change your mind: just sign in and the deletion is cancelled.`,
      'When it is deleted, your unused match credits that came from a paid ticket are refunded to the card or bank account you paid with, and any other credits lapse (Terms clause 20.2).',
      `If you did not ask for this, sign in now and change your password: ${appUrl('/login')}`,
    ]);
    return { scheduledFor: outcome.scheduledFor.toISOString() };
  }

  /** Item 6: admins see the latest refused attempt and why (one row per player, replaced each time). */
  private async recordBlocked(userId: string, preview: AccountDeletionPreview) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.accountDeletionRequest.deleteMany({ where: { userId, status: 'BLOCKED' } });
        await tx.accountDeletionRequest.create({
          data: { userId, status: 'BLOCKED', blockedReasons: preview.blockers.map(({ code }) => code) },
        });
      });
    } catch (error) {
      logError('account_deletion_blocked_record_failed', error, { userId });
    }
  }

  /**
   * D4, DEC-021 D11: upcoming matches are left under the normal ticket rules (clause 14.3; more than 24 hours out a
   * place the player paid for is refunded to the original payment method), and a hosted match nobody joined is
   * cancelled. Each runs through the normal service. A failure here (for example the lock arriving in the
   * meantime) is retried by the final step, which never runs while the player is still in a live match.
   */
  async applyMatchPlans(userId: string, preview: Pick<AccountDeletionPreview, 'matches'>) {
    for (const plan of preview.matches) {
      try {
        if (plan.outcome === 'HOSTED_MATCH_CANCELLED') await this.matches.remove(plan.matchId, userId);
        // DEC-021 (D11): a ticket more than 24 hours out is refunded to the card or bank it was paid with.
        else if (plan.outcome !== 'LEFT_OUT_OF_SQUAD') await this.tickets.leave(plan.matchId, userId, 'REFUND');
      } catch (error) {
        logError('account_deletion_match_plan_failed', error, { userId, matchId: plan.matchId, outcome: plan.outcome });
      }
    }
  }

  async sendEmail(to: string, subject: string, paragraphs: string[]) {
    try {
      await this.emails.send({ to, subject, text: [...paragraphs, '', 'FootyFinder'].join('\n\n') });
    } catch (error) {
      logError('account_deletion_email_failed', error, { subject });
    }
  }
}
