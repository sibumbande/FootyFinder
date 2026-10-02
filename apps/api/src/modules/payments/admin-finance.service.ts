import { paymentChannelLabel, type AdminRestrictedWallet, type AdminTopUp } from '@footy-finder/shared';
import type { ProviderDispute, ProviderPayment, ProviderRefund } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';

type PaymentRow = ProviderPayment & {
  user: { id: string; username: string; email: string };
  refunds: ProviderRefund[];
  disputes: ProviderDispute[];
};

/** Admin-only DTO: provider references are visible to platform admins only (DEC-014 pattern). */
export const toAdminTopUp = (row: PaymentRow): AdminTopUp => {
  const committed = row.refunds
    .filter((refund) => refund.status !== 'RESTORED_TO_WALLET')
    .reduce((sum, refund) => sum + refund.amountCents, 0);
  return {
    id: row.id,
    reference: row.reference,
    player: { id: row.user.id, username: row.user.username, email: row.user.email },
    amountCents: row.amountCents,
    status: row.status,
    creditedBy: row.creditedBy ?? undefined,
    providerStatus: row.providerStatus ?? undefined,
    providerTransactionId: row.providerTransactionId ?? undefined,
    failureReason: row.failureReason ?? undefined,
    reviewReason: row.reviewReason ?? undefined,
    refundableCents: row.status === 'SUCCEEDED' && !row.disputes.length ? row.amountCents - committed : 0,
    ...(row.channel && { paymentMethod: paymentChannelLabel(row.channel)! }),
    refunds: row.refunds.map((refund) => ({
      id: refund.id,
      amountCents: refund.amountCents,
      state: refund.status,
      reason: refund.reason,
      failureReason: refund.failureReason ?? undefined,
      reviewReason: refund.reviewReason ?? undefined,
      attempts: refund.attempts,
      providerRefundId: refund.providerRefundId ?? undefined,
      restoreReason: refund.restoreReason ?? undefined,
      createdAt: refund.createdAt.toISOString(),
    })),
    disputes: row.disputes.map((dispute) => ({
      id: dispute.id,
      providerDisputeId: dispute.providerDisputeId,
      status: dispute.status,
      amountCents: dispute.amountCents,
      resolution: dispute.resolution ?? undefined,
      openedAt: dispute.openedAt.toISOString(),
      resolvedAt: dispute.resolvedAt?.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
  };
};

export class AdminFinanceService {
  async topUps(query: { status?: AdminTopUp['status']; reference?: string }) {
    const rows = await prisma.providerPayment.findMany({
      where: {
        ...(query.status && { status: query.status }),
        ...(query.reference && { reference: query.reference }),
      },
      include: {
        user: { select: { id: true, username: true, email: true } },
        refunds: { orderBy: { createdAt: 'asc' } },
        disputes: { orderBy: { openedAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toAdminTopUp);
  }

  async topUp(id: string) {
    const row = await prisma.providerPayment.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, email: true } },
        refunds: { orderBy: { createdAt: 'asc' } },
        disputes: { orderBy: { openedAt: 'asc' } },
      },
    });
    return row ? toAdminTopUp(row) : null;
  }

  async restrictedWallets(): Promise<AdminRestrictedWallet[]> {
    const wallets = await prisma.walletAccount.findMany({
      where: { spendingRestrictedAt: { not: null } },
      include: { user: { select: { id: true, username: true } } },
      orderBy: { spendingRestrictedAt: 'asc' },
      take: 200,
    });
    const open = await prisma.providerDispute.groupBy({
      by: ['providerPaymentId'],
      where: { status: 'OPEN', providerPayment: { userId: { in: wallets.map((wallet) => wallet.userId) } } },
      _count: { _all: true },
    });
    const payments = await prisma.providerPayment.findMany({
      where: { id: { in: open.map((row) => row.providerPaymentId) } },
      select: { id: true, userId: true },
    });
    const openByUser = new Map<string, number>();
    for (const row of open) {
      const userId = payments.find((payment) => payment.id === row.providerPaymentId)?.userId;
      if (userId) openByUser.set(userId, (openByUser.get(userId) ?? 0) + row._count._all);
    }
    return wallets.map((wallet) => ({
      userId: wallet.userId,
      username: wallet.user.username,
      balanceCents: wallet.balanceCents,
      restrictedAt: wallet.spendingRestrictedAt!.toISOString(),
      reason: wallet.spendingRestrictionReason ?? undefined,
      openDisputes: openByUser.get(wallet.userId) ?? 0,
    }));
  }
}
