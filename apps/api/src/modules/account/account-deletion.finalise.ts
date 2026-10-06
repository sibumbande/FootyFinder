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
import { requestTicketRefundInTx } from '../tickets/ticket-refunds.js';
import { PlayerPhotoStorage } from '../profiles/player-photo.storage.js';
import { TeamsRepository } from '../teams/teams.repository.js';
import { AccountDeletionService, finaliseJobInput } from './account-deletion.service.js';
import { buildDeletionPreview } from './account-deletion.preview.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const ACCOUNT_DELETION_SETTLE_CHECK_JOB = 'ACCOUNT_DELETION_SETTLE_CHECK';
/** Refunds that still need Paystack or finance before the case is settled. */
const OPEN_REFUND_STATUSES = ['PENDING', 'PROCESSING', 'NEEDS_ATTENTION', 'FAILED'] as const;
/** Refunds still with Paystack: the final step waits for these (NEEDS_ATTENTION and FAILED are with finance). */
const WITH_PAYSTACK_STATUSES = ['PENDING', 'PROCESSING'] as const;

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
 * CEO batch 5, item 3, adapted to DEC-021 (D11): the final step, 14 days after the player confirmed (a durable job).
 * In order:
 * 1. anything still open is settled or waited for (a live match, a match left on confirm);
 * 2. each unused match credit that came from a paid ticket is refunded (R80, partial) to the original payment method
 *    of that ticket, through the ticket refund path; credits with no cash origin lapse (FORFEITED);
 * 3. the step waits until these refunds and the ticket refunds from confirm are processed, or handed to finance
 *    (NEEDS_ATTENTION / FAILED). Anything that cannot be refunded automatically goes to finance; money is never
 *    kept or wiped;
 * 4. the account is anonymised (never hard-deleted), keeping only what the law or other players need;
 * 5. a final email is sent.
 * Every step can run again safely. When something must clear first, the request is WAITING and is checked
 * again the next day (D5).
 */
export class AccountDeletionFinaliser {
  constructor(
    private readonly refunds = new CardRefundsService(),
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
    // Refunds are waited for in step 3 (and a refund with finance does not hold the deletion up).
    const blocking = preview.blockers.filter(({ code }) => code !== 'REFUND_IN_PROGRESS');
    if (blocking.length) return this.wait(request.id, attempt, blocking.map(({ code }) => code).join(','), now);

    // An empty team they own is closed through the normal close path.
    const owned = await prisma.team.findMany({ where: { ownerUserId: request.userId, archivedAt: null }, select: { id: true } });
    for (const team of owned) {
      const closed = await this.teams.close(team.id, request.userId);
      if (closed.outcome === 'UPCOMING_MATCHES')
        return this.wait(request.id, attempt, 'OWNED_TEAM_NOT_CLOSABLE', now);
    }

    // 2. Unused credits from a paid ticket are refunded; credits with no cash origin lapse.
    const { lines, uncoveredCents } = await this.refundCredits(request.userId, request.id, now);

    // 3. Wait while any refund of theirs is still with Paystack (finance has the rest).
    const withPaystack = await prisma.providerRefund.count({ where: { providerPayment: { userId: request.userId }, status: { in: [...WITH_PAYSTACK_STATUSES] } } });
    if (withPaystack) return this.wait(request.id, attempt, 'REFUNDS_IN_PROGRESS', now);

    // 4. Anonymise.
    const photoKey = await this.anonymise(request.userId, request.id, user, lines, uncoveredCents, now);
    if (photoKey) await this.photos.delete(photoKey).catch((error) => logError('account_deletion_photo_delete_failed', error, { requestId }));

    // 5. Final email. The address is kept (finance only) while a refund still needs finance (D2).
    await this.deletion.sendEmail(user.email, 'Your FootyFinder account has been deleted', [
      'Your FootyFinder account has now been deleted. Your profile, photo, username and email address have been removed, and your past matches show "Deleted player".',
      ...(lines.length
        ? [`Your unused match credits have been refunded the way you paid for them: ${lines.map((line) => `${formatRands(line.amountCents)} to your ${channelName(line.channel)}`).join(', ')}. Card refunds usually take a few working days. If a bank refund needs your account details, our finance team will email you.`]
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

  /**
   * D11: each unused credit that came from a paid ticket is refunded (the ticket's price, a partial refund) to the
   * payment method of that ticket, once per credit; a credit with no cash origin lapses. A credit that cannot be
   * refunded automatically stays for finance (uncovered). Safe to run again: earlier closure refunds are reused.
   */
  private async refundCredits(userId: string, requestId: string, now: Date) {
    const credits = await prisma.matchCredit.findMany({ where: { userId, status: 'AVAILABLE', expiresAt: { gt: now } }, select: { id: true, originTicketId: true } });
    let uncoveredCents = 0;
    for (const credit of credits) {
      try {
        const refundId = await serializableTransaction(async (tx) => {
          const claimed = await tx.matchCredit.updateMany({
            where: { id: credit.id, status: 'AVAILABLE' },
            data: { status: credit.originTicketId ? 'REFUNDED' : 'FORFEITED', closedAt: now },
          });
          if (!claimed.count) return null;
          if (!credit.originTicketId) {
            await tx.matchCreditEvent.create({ data: { creditId: credit.id, type: 'FORFEITED', note: 'Account deleted: a credit with no cash origin lapses (DEC-021 D11)' } });
            return null;
          }
          const refund = await requestTicketRefundInTx(tx, {
            ticketId: credit.originTicketId,
            creditId: credit.id,
            source: 'ACCOUNT_CLOSURE',
            reason: 'Account closure: unused match credit (Terms clause 20.2)',
            initiatedByUserId: userId,
          });
          await tx.matchCreditEvent.create({ data: { creditId: credit.id, type: 'REFUNDED', ticketId: credit.originTicketId, note: 'Account deleted: refunded to the original payment method (DEC-021 D11)' } });
          return refund.id;
        });
        // The queued job sends it too; sending now means Paystack has it before the wait below.
        if (refundId) await this.refunds.submitQueued(refundId).catch((error: unknown) => logError('account_deletion_refund_submit_failed', error, { requestId, refundId }));
      } catch (error) {
        logError('account_deletion_credit_refund_failed', error, { requestId, creditId: credit.id });
        const origin = credit.originTicketId ? await prisma.matchTicket.findUnique({ where: { id: credit.originTicketId }, select: { amountCents: true } }) : null;
        uncoveredCents += origin?.amountCents ?? 0;
      }
    }
    const refunds = await prisma.providerRefund.findMany({
      where: { source: 'ACCOUNT_CLOSURE', providerPayment: { userId } },
      select: { id: true, providerPaymentId: true, amountCents: true, status: true, providerPayment: { select: { channel: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const lines: ClosureRefundLine[] = refunds.map((refund) => ({
      refundId: refund.id, providerPaymentId: refund.providerPaymentId, channel: refund.providerPayment.channel, amountCents: refund.amountCents, status: refund.status,
    }));
    return { lines, uncoveredCents };
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
   * D2: once every refund of theirs has been processed (or finance has marked the case settled) and the final
   * email has been sent, the contact email is erased. Re-checked daily until then.
   */
  async settleCheck(requestId: string, now = new Date()) {
    const request = await prisma.accountDeletionRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== 'COMPLETED' || !request.contactEmail) return { settled: true };
    // D11: credit refunds and ticket refunds alike; the address is kept until every one is done or settled.
    const open = await prisma.providerRefund.count({
      where: { providerPayment: { userId: request.userId }, status: { in: [...OPEN_REFUND_STATUSES] } },
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
