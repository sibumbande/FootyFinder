import { env } from '../../config/env.js';
import { serializableTransaction } from '../../database/transaction.js';
import { logError } from '../../observability/logger.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { createEmailProvider, type EmailProvider } from '../auth/email.provider.js';

/**
 * CEO batch 5, item 2 (D6): signing in with the right password during the 14-day grace period cancels the
 * deletion and reactivates the account. Returns true when a deletion was cancelled. Friends, blocks, team
 * memberships and messages were only hidden, so they come back; matches already left stay left.
 */
export async function cancelDeletionOnSignIn(userId: string, emails: EmailProvider = createEmailProvider()) {
  const cancelled = await serializableTransaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { accountStatus: true, email: true } });
    if (user.accountStatus !== 'PENDING_DELETION') return null;
    const request = await tx.accountDeletionRequest.findFirst({ where: { userId, status: { in: ['GRACE', 'WAITING'] } } });
    const now = new Date();
    if (request)
      await tx.accountDeletionRequest.update({ where: { id: request.id }, data: { status: 'CANCELLED', cancelledAt: now } });
    await tx.user.update({ where: { id: userId }, data: { accountStatus: 'ACTIVE' } });
    await appendAdminAudit(tx, {
      actorUserId: userId,
      action: 'ACCOUNT_DELETION_CANCELLED',
      entityType: 'USER',
      entityId: userId,
      metadata: { deletionRequestId: request?.id ?? null, by: 'SIGN_IN' },
    });
    return user.email;
  });
  if (!cancelled) return false;
  try {
    await emails.send({
      to: cancelled,
      subject: 'Your FootyFinder account deletion was cancelled',
      text: [
        'You signed in to FootyFinder, so we cancelled the deletion of your account. Your account is active again.',
        'Your friends, teams and messages are back. Matches you left when you asked for deletion stay left, and any "Looking for a team" card stays off until you switch it on again.',
        `If this wasn't you, change your password straight away: ${env.CLIENT_URL.replace(/\/$/, '')}/forgot-password`,
        '',
        'FootyFinder',
      ].join('\n\n'),
    });
  } catch (error) {
    logError('account_deletion_cancel_email_failed', error, { userId });
  }
  return true;
}
