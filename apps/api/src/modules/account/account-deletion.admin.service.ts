import { DELETED_PLAYER_NAME, paymentChannelLabel, type AdminAccountDeletionRequest, type AccountDeletionStatus } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../errors/app-error.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { AccountDeletionFinaliser, type ClosureRefundLine } from './account-deletion.finalise.js';
import { REFUND_IN_PROGRESS_STATUSES } from './account-deletion.preview.js';

/**
 * CEO batch 5, item 6: what admins see of deletion requests. Read-only: nobody can speed up a deletion or undo a
 * completed anonymisation. Finance can only record that a deleted account's money has been settled (D2).
 */
export class AccountDeletionAdminService {
  constructor(private readonly finaliser = new AccountDeletionFinaliser()) {}

  async list(status?: AccountDeletionStatus): Promise<AdminAccountDeletionRequest[]> {
    const rows = await prisma.accountDeletionRequest.findMany({
      where: status ? { status } : {},
      include: {
        user: {
          select: {
            accountStatus: true,
            username: true,
            profile: { select: { displayName: true } },
            walletAccount: { select: { balanceCents: true } },
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
    });
    const refundIds = rows.flatMap((row) => ((row.refundSummary as ClosureRefundLine[] | null) ?? []).map(({ refundId }) => refundId)).filter((id): id is string => Boolean(id));
    const current = new Map(
      (await prisma.providerRefund.findMany({ where: { id: { in: refundIds } }, select: { id: true, status: true } })).map(({ id, status }) => [id, status]),
    );
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      status: row.status,
      displayName: row.user.accountStatus === 'DELETED' ? DELETED_PLAYER_NAME : (row.user.profile?.displayName ?? row.user.username),
      requestedAt: row.requestedAt.toISOString(),
      scheduledFor: row.scheduledFor?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      blockedReasons: row.blockedReasons,
      waitingReason: row.waitingReason,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      refunds: ((row.refundSummary as ClosureRefundLine[] | null) ?? []).map((line) => ({
        refundId: line.refundId,
        amountCents: line.amountCents,
        method: line.channel ? (paymentChannelLabel(line.channel) ?? line.channel) : null,
        status: (line.refundId && current.get(line.refundId)) || line.status,
      })),
      uncoveredCents: row.uncoveredCents,
      walletBalanceCents: row.user.walletAccount?.balanceCents ?? 0,
      contactEmail: row.contactEmail,
      finalEmailSentAt: row.finalEmailSentAt?.toISOString() ?? null,
      financeSettledAt: row.financeSettledAt?.toISOString() ?? null,
      financeNote: row.financeNote,
    }));
  }

  /**
   * Finance records that a deleted account's remaining money has been returned (for example the uncovered amount
   * paid back by EFT). Only once no closure refund is still open; the contact email is then erased.
   */
  async settle(requestId: string, adminUserId: string, note: string, auditRequestId?: string) {
    const request = await prisma.accountDeletionRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== 'COMPLETED')
      throw new AppError(404, 'Completed deletion request not found.', 'DELETION_REQUEST_NOT_FOUND');
    if (request.financeSettledAt) throw new AppError(409, 'This deletion is already settled.', 'DELETION_ALREADY_SETTLED');
    const open = await prisma.providerRefund.count({
      where: { source: 'ACCOUNT_CLOSURE', providerPayment: { userId: request.userId }, status: { in: [...REFUND_IN_PROGRESS_STATUSES] } },
    });
    if (open)
      throw new AppError(409, 'A closure refund is still open. Finish it on the Finance page first.', 'DELETION_REFUNDS_OPEN');
    await prisma.$transaction(async (tx) => {
      await tx.accountDeletionRequest.update({
        where: { id: requestId },
        data: { financeSettledAt: new Date(), financeSettledById: adminUserId, financeNote: note },
      });
      await appendAdminAudit(tx, {
        actorUserId: adminUserId,
        action: 'ACCOUNT_CLOSURE_SETTLED',
        entityType: 'AccountDeletionRequest',
        entityId: requestId,
        requestId: auditRequestId,
        metadata: { note, uncoveredCents: request.uncoveredCents },
      });
    });
    await this.finaliser.settleCheck(requestId);
    return (await this.list()).find(({ id }) => id === requestId)!;
  }
}
