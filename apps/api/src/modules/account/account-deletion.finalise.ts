import { randomBytes, randomUUID } from 'node:crypto';
import { DELETED_PLAYER_MESSAGE, DELETED_PLAYER_NAME } from '@footy-finder/shared';
import argon2 from 'argon2';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { Prisma } from '../../generated/prisma/client.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';
import { logError, logInfo } from '../../observability/logger.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { formatRands } from '../matches/cancellation-message.js';
import { CardRefundsService } from '../payments/card-refunds.service.js';
import { PlayerPhotoStorage } from '../profiles/player-photo.storage.js';
import { TeamWalletService } from '../team-wallet/team-wallet.service.js';
import { TeamsRepository } from '../teams/teams.repository.js';
import { AccountDeletionService, finaliseJobInput } from './account-deletion.service.js';
import { buildDeletionPreview } from './account-deletion.preview.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const ACCOUNT_DELETION_SETTLE_CHECK_JOB = 'ACCOUNT_DELETION_SETTLE_CHECK';
/** Closure refunds that still need Paystack or finance before the case is settled. */
const OPEN_REFUND_STATUSES = ['PENDING', 'PROCESSING', 'NEEDS_ATTENTION', 'FAILED'] as const;

export type ClosureRefundLine = {
  refundId: string | null;
  providerPaymentId: string;
  channel: string | null;
  amountCents: number;
  status: string;
  error?: string;
};

const notDue = () => Object.assign(new Error('The 14-day grace period has not ended yet.'), { code: 'ACCOUNT_DELETION_NOT_DUE' });

/**
 * CEO batch 5, item 3: the final step, 14 days after the player confirmed (a durable job). In order:
 * 1. anything still open is settled or waited for (a live match, Team Wallet money held in a Fill Meter);
 * 2. the player's own unspent Team Wallet contributions go back to their Wallet (ToS 12.4);
 * 3. the whole Wallet balance is refunded the way they paid, newest top-up first, through the Gate 6 refund
 *    path (D1). NEEDS_ATTENTION / FAILED refunds and any amount no top-up covers go to finance; money is never
 *    kept or wiped;
 * 4. the account is anonymised (never hard-deleted), keeping only what the law or other players need;
 * 5. a final email is sent.
 * Every step can run again safely. When something must clear first, the request is WAITING and is checked
 * again the next day (D5).
 */
export class AccountDeletionFinaliser {
  constructor(
    private readonly refunds = new CardRefundsService(),
    private readonly teamWallet = new TeamWalletService(),
    private readonly teams = new TeamsRepository(),
    private readonly deletion = new AccountDeletionService(),
    private readonly photos = new PlayerPhotoStorage(env.PLAYER_UPLOAD_DIR),
  ) {}

  async finalise(requestId: string, attempt: number, now = new Date()) {
    const request = await prisma.accountDeletionRequest.findUnique({ where: { id: requestId } });
    if (!request || !['GRACE', 'WAITING'].includes(request.status)) return { outcome: 'NOTHING_TO_DO' as const };
    if (request.scheduledFor && request.scheduledFor > now) throw notDue();
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.userId },
      select: { accountStatus: true, email: true, profile: { select: { displayName: true } }, username: true },
    });
    if (user.accountStatus !== 'PENDING_DELETION')
      return this.wait(request.id, attempt, user.accountStatus === 'ACTIVE' ? 'ACCOUNT_ACTIVE_AGAIN' : 'ACCOUNT_RESTRICTED', now);

    // 1. Matches left over (for example a leave that failed on confirm) and anything that still blocks.
    const before = await serializableTransaction((tx) => buildDeletionPreview(tx, request.userId, now));
    await this.deletion.applyMatchPlans(request.userId, {
      matches: before.matches.filter(({ outcome }) => outcome !== 'LEFT_OUT_OF_SQUAD'),
    });
    const preview = await serializableTransaction((tx) => buildDeletionPreview(tx, request.userId, now));
    // A rerun after a crash must not wait on the closure refunds this step started itself.
    const otherRefundsInProgress = await prisma.providerRefund.count({
      where: { providerPayment: { userId: request.userId }, source: { not: 'ACCOUNT_CLOSURE' }, status: { in: [...OPEN_REFUND_STATUSES] } },
    });
    const blocking = preview.blockers.filter(({ code }) => code !== 'REFUND_IN_PROGRESS' || otherRefundsInProgress > 0);
    if (blocking.length) return this.wait(request.id, attempt, blocking.map(({ code }) => code).join(','), now);

    // 2. Own unspent Team Wallet contributions back to the Wallet (what is held in a Fill Meter waits).
    const heldBack = await this.returnTeamContributions(request.userId, request.id);
    if (heldBack > 0) return this.wait(request.id, attempt, 'TEAM_MONEY_HELD', now);
    const walletHolds = await prisma.walletHold.count({
      where: { status: 'ACTIVE', walletAccount: { userId: request.userId }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    });
    if (walletHolds) return this.wait(request.id, attempt, 'WALLET_HOLD', now);

    // An empty team they own is closed through the normal close path.
    const owned = await prisma.team.findMany({ where: { ownerUserId: request.userId, archivedAt: null }, select: { id: true } });
    for (const team of owned) {
      const closed = await this.teams.close(team.id, request.userId);
      if (closed.outcome === 'UPCOMING_MATCHES')
        return this.wait(request.id, attempt, 'OWNED_TEAM_NOT_CLOSABLE', now);
    }

    // 3. Refund the Wallet the way the player paid.
    const { lines, uncoveredCents } = await this.refundWallet(request.userId, request.id);

    // 4. Anonymise.
    const photoKey = await this.anonymise(request.userId, request.id, user, lines, uncoveredCents, now);
    if (photoKey) await this.photos.delete(photoKey).catch((error) => logError('account_deletion_photo_delete_failed', error, { requestId }));

    // 5. Final email. The address is kept (finance only) while a refund still needs finance (D2).
    await this.deletion.sendEmail(user.email, 'Your FootyFinder account has been deleted', [
      'Your FootyFinder account has now been deleted. Your profile, photo, username and email address have been removed, and your past matches show "Deleted player".',
      ...(lines.length
        ? [`Your Wallet balance is being refunded the way you paid: ${lines.map((line) => `${formatRands(line.amountCents)} to your ${channelName(line.channel)}`).join(', ')}. Card refunds usually take a few working days. If a bank refund needs your account details, our finance team will email you.`]
        : []),
      ...(uncoveredCents > 0
        ? [`${formatRands(uncoveredCents)} could not be refunded automatically. Our finance team will contact you at this address to return it. We never keep your money (Terms clause 20.2).`]
        : []),
      'We keep only what the law requires (payment records for 5 years, the record that you accepted our Terms, and conduct records for 3 years), under an anonymous ID.',
      'Thank you for playing with FootyFinder.',
    ]);
    await prisma.accountDeletionRequest.update({ where: { id: request.id }, data: { finalEmailSentAt: new Date() } });
    await this.settleCheck(request.id);
    logInfo('account_deletion_completed', { requestId, refunds: lines.length, uncoveredCents });
    return { outcome: 'COMPLETED' as const, lines, uncoveredCents };
  }

  private async wait(requestId: string, attempt: number, reason: string, now: Date) {
    await serializableTransaction(async (tx) => {
      await tx.accountDeletionRequest.update({
        where: { id: requestId },
        data: { status: 'WAITING', waitingReason: reason.slice(0, 300), lastCheckedAt: now },
      });
      await enqueueDurableJob(tx, finaliseJobInput(requestId, new Date(now.getTime() + DAY_MS), attempt + 1));
    });
    logInfo('account_deletion_waiting', { requestId, reason });
    return { outcome: 'WAITING' as const, reason };
  }

  /** Returns what is still held back (in a Fill Meter) after returning everything that can be. */
  private async returnTeamContributions(userId: string, requestId: string) {
    let heldBack = 0;
    for (const item of await this.teamWallet.reclaimable(userId)) {
      if (item.refundableCents > 0)
        await this.teamWallet.refund(item.team.id, userId, item.refundableCents, `account-closure-${requestId}-${item.unspentCents}`);
      heldBack += item.unspentCents - item.refundableCents;
    }
    return heldBack;
  }

  /** D1: newest successful top-up first, each up to what it has not already refunded. */
  private async refundWallet(userId: string, requestId: string) {
    const lines: ClosureRefundLine[] = [];
    const existing = await prisma.providerRefund.findMany({
      where: { source: 'ACCOUNT_CLOSURE', providerPayment: { userId } },
      select: { id: true, providerPaymentId: true, amountCents: true, status: true, providerPayment: { select: { channel: true } } },
    });
    for (const refund of existing)
      lines.push({ refundId: refund.id, providerPaymentId: refund.providerPaymentId, channel: refund.providerPayment.channel, amountCents: refund.amountCents, status: refund.status });
    const alreadyRefunded = new Set(existing.map(({ providerPaymentId }) => providerPaymentId));
    const wallet = await prisma.walletAccount.findUnique({ where: { userId } });
    let remaining = Math.max(0, wallet?.balanceCents ?? 0);
    const payments = await prisma.providerPayment.findMany({
      where: { userId, status: 'SUCCEEDED', disputes: { none: {} } },
      include: { refunds: { select: { amountCents: true, status: true } } },
      orderBy: [{ verifiedAt: 'desc' }, { createdAt: 'desc' }],
    });
    for (const payment of payments) {
      if (remaining <= 0) break;
      if (alreadyRefunded.has(payment.id)) continue;
      const committed = payment.refunds.filter(({ status }) => status !== 'RESTORED_TO_WALLET').reduce((sum, { amountCents }) => sum + amountCents, 0);
      const amountCents = Math.min(remaining, payment.amountCents - committed);
      if (amountCents <= 0) continue;
      try {
        const refund = await this.refunds.initiate({
          actorUserId: userId,
          providerPaymentId: payment.id,
          amountCents,
          reason: 'Account closure (Terms clause 20.2)',
          idempotencyKey: `account-closure:${requestId}`,
          source: 'ACCOUNT_CLOSURE',
        });
        lines.push({ refundId: refund.id, providerPaymentId: payment.id, channel: payment.channel, amountCents, status: refund.status });
        remaining -= amountCents;
      } catch (error) {
        logError('account_deletion_refund_failed', error, { requestId, providerPaymentId: payment.id });
        lines.push({ refundId: null, providerPaymentId: payment.id, channel: payment.channel, amountCents, status: 'NOT_STARTED', error: error instanceof Error ? error.message.slice(0, 120) : 'error' });
      }
    }
    const after = await prisma.walletAccount.findUnique({ where: { userId } });
    return { lines, uncoveredCents: Math.max(0, after?.balanceCents ?? 0) };
  }

  private async anonymise(
    userId: string,
    requestId: string,
    original: { email: string; username: string; profile: { displayName: string } | null },
    lines: ClosureRefundLine[],
    uncoveredCents: number,
    now: Date,
  ) {
    const passwordHash = await argon2.hash(randomBytes(32).toString('base64url'), { type: argon2.argon2id });
    const names = [...new Set([original.profile?.displayName, original.username].filter((name): name is string => Boolean(name && name.length >= 3)))];
    return serializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const current = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { accountStatus: true } });
      if (current.accountStatus !== 'PENDING_DELETION') throw Object.assign(new Error('Account is no longer pending deletion.'), { code: 'ACCOUNT_DELETION_STATE_CHANGED' });

      // Players connected to them, whose own notifications may name them (rewritten below).
      const connected = await connectedUserIds(tx, userId);

      const profile = await tx.playerProfile.findUnique({ where: { userId }, select: { id: true, photo: { select: { fileKey: true } } } });
      if (profile) {
        await tx.playerPreferredPosition.deleteMany({ where: { profileId: profile.id } });
        await tx.playerPhoto.deleteMany({ where: { profileId: profile.id } });
        await tx.playerProfile.update({
          where: { id: profile.id },
          data: { displayName: DELETED_PLAYER_NAME, avatarUrl: null, bio: null, dominantFoot: null, gender: null, homeArea: null, dateOfBirth: null, yearsExperience: null, cityId: null },
        });
      }
      await tx.user.update({
        where: { id: userId },
        data: {
          accountStatus: 'DELETED',
          email: `deleted-${randomUUID()}@deleted.invalid`,
          username: `deleted_${userId.replace(/-/g, '')}`,
          passwordHash,
          friendRequestsEnabled: false,
        },
      });

      // Social: friendships, requests, blocks, invites, join requests, posts and the looking card.
      await tx.friendship.deleteMany({ where: { OR: [{ userLowId: userId }, { userHighId: userId }] } });
      await tx.friendRequest.deleteMany({ where: { OR: [{ requesterId: userId }, { recipientId: userId }] } });
      await tx.userBlock.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
      await tx.teamMemberInvite.deleteMany({ where: { OR: [{ inviteeId: userId }, { invitedById: userId }] } });
      await tx.teamJoinRequest.deleteMany({ where: { userId } });
      await tx.teamRecruitmentPost.deleteMany({ where: { createdById: userId } });
      await tx.playerLookingCard.deleteMany({ where: { userId } });

      // Team memberships (formation spots freed first, as when a member is removed).
      await tx.teamFormationSlot.updateMany({ where: { membership: { userId } }, data: { membershipId: null } });
      await tx.teamMembership.deleteMany({ where: { userId } });
      await tx.teamChatReadState.deleteMany({ where: { userId } });

      // Waiting list, notifications, sessions, tokens, admin MFA.
      const interests = await tx.cityInterest.findMany({ where: { userId }, select: { id: true } });
      for (const interest of interests)
        await tx.cityInterest.update({
          where: { id: interest.id },
          data: { deletedAt: now, unsubscribedAt: now, email: `deleted-${interest.id}@deleted.invalid`, dedupeKey: `deleted:${interest.id}`, userId: null },
        });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.authSession.deleteMany({ where: { userId } });
      await tx.verificationToken.deleteMany({ where: { userId } });
      await tx.adminMfaCredential.deleteMany({ where: { userId } });

      // Messages: their own DM, Lobby and Team chat messages lose their content; the other person's stay.
      await tx.directMessage.updateMany({ where: { senderId: userId }, data: { content: DELETED_PLAYER_MESSAGE } });
      await tx.lobbyMessage.updateMany({ where: { senderId: userId }, data: { content: DELETED_PLAYER_MESSAGE } });
      await tx.teamMessage.updateMany({ where: { senderId: userId }, data: { content: DELETED_PLAYER_MESSAGE } });

      // Reviews they wrote (D8): deleted as if the author had deleted them; the text is erased.
      await tx.teamReview.updateMany({ where: { authorUserId: userId }, data: { status: 'DELETED', text: null, textStatus: null } });

      // Other players' notifications that name them.
      for (const name of names)
        if (connected.length)
          await tx.$executeRaw`
            UPDATE "Notification"
            SET "title" = replace("title", ${name}, ${DELETED_PLAYER_NAME}),
                "message" = replace("message", ${name}, ${DELETED_PLAYER_NAME})
            WHERE "userId" = ANY(${connected}::uuid[])
              AND (strpos("title", ${name}) > 0 OR strpos("message", ${name}) > 0)`;

      // Moderation evidence about them keeps the facts but not their name.
      const reports = await tx.moderationReport.findMany({ where: { targetType: 'USER', targetId: userId }, select: { id: true, evidenceSnapshot: true } });
      for (const report of reports)
        await tx.moderationReport.update({
          where: { id: report.id },
          data: { evidenceSnapshot: { ...(report.evidenceSnapshot as Prisma.JsonObject | null ?? {}), username: null, displayName: DELETED_PLAYER_NAME } },
        });

      await tx.accountDeletionRequest.update({
        where: { id: requestId },
        data: {
          status: 'COMPLETED',
          completedAt: now,
          lastCheckedAt: now,
          waitingReason: null,
          refundSummary: lines as unknown as Prisma.InputJsonValue,
          uncoveredCents,
          // D2: kept only while finance may still need to contact the player about money.
          contactEmail: original.email,
          financeSettledAt: null,
        },
      });
      await appendAdminAudit(tx, {
        action: 'ACCOUNT_DELETION_COMPLETED',
        entityType: 'USER',
        entityId: userId,
        metadata: { deletionRequestId: requestId, refundCount: lines.length, uncoveredCents },
      });
      return profile?.photo?.fileKey ?? null;
    });
  }

  /**
   * D2: once every closure refund has been processed (or finance has marked the case settled) and the final
   * email has been sent, the contact email is erased. Re-checked daily until then.
   */
  async settleCheck(requestId: string, now = new Date()) {
    const request = await prisma.accountDeletionRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== 'COMPLETED' || !request.contactEmail) return { settled: true };
    const open = await prisma.providerRefund.count({
      where: { source: 'ACCOUNT_CLOSURE', providerPayment: { userId: request.userId }, status: { in: [...OPEN_REFUND_STATUSES] } },
    });
    const settled = Boolean(request.financeSettledAt) || (open === 0 && request.uncoveredCents === 0);
    if (settled && request.finalEmailSentAt) {
      await prisma.accountDeletionRequest.update({
        where: { id: requestId },
        data: { contactEmail: null, financeSettledAt: request.financeSettledAt ?? now },
      });
      return { settled: true };
    }
    await prisma.$transaction((tx) =>
      enqueueDurableJob(tx, {
        type: ACCOUNT_DELETION_SETTLE_CHECK_JOB,
        dedupeKey: `account-deletion-settle:${requestId}:${now.toISOString().slice(0, 10)}`,
        payload: { requestId },
        runAt: new Date(now.getTime() + DAY_MS),
      }),
    );
    return { settled: false };
  }
}

const channelName = (channel: string | null) =>
  channel === 'apple_pay' ? 'Apple Pay' : channel === 'capitec_pay' ? 'Capitec Pay account' : channel === 'eft' ? 'bank account (Instant EFT)' : 'card';

/** Everyone who could have received a notification naming this player. */
async function connectedUserIds(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT other."userId" AS "id" FROM "MatchParticipant" mine
      JOIN "MatchParticipant" other ON other."matchId" = mine."matchId"
      WHERE mine."userId" = ${userId}::uuid AND other."userId" <> ${userId}::uuid
    UNION SELECT DISTINCT other."userId" FROM "TeamMembership" mine
      JOIN "TeamMembership" other ON other."teamId" = mine."teamId"
      WHERE mine."userId" = ${userId}::uuid AND other."userId" <> ${userId}::uuid
    UNION SELECT DISTINCT other."userId" FROM "ConversationParticipant" mine
      JOIN "ConversationParticipant" other ON other."conversationId" = mine."conversationId"
      WHERE mine."userId" = ${userId}::uuid AND other."userId" <> ${userId}::uuid
    UNION SELECT CASE WHEN "requesterId" = ${userId}::uuid THEN "recipientId" ELSE "requesterId" END FROM "FriendRequest"
      WHERE "requesterId" = ${userId}::uuid OR "recipientId" = ${userId}::uuid
    UNION SELECT CASE WHEN "userLowId" = ${userId}::uuid THEN "userHighId" ELSE "userLowId" END FROM "Friendship"
      WHERE "userLowId" = ${userId}::uuid OR "userHighId" = ${userId}::uuid
    UNION SELECT DISTINCT other."userId" FROM "TeamMatchSelection" mine
      JOIN "MatchTeam" mt ON mt."id" = mine."matchTeamId"
      JOIN "TeamMembership" other ON other."teamId" = mt."teamId"
      WHERE mine."userId" = ${userId}::uuid AND other."userId" <> ${userId}::uuid
    UNION SELECT DISTINCT tm."userId" FROM "TeamJoinRequest" jr
      JOIN "TeamMembership" tm ON tm."teamId" = jr."teamId"
      WHERE jr."userId" = ${userId}::uuid`;
  return rows.map(({ id }) => id);
}
