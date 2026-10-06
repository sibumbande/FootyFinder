import { paymentChannelLabel, type AdminPayment } from '@footy-finder/shared';
import type { ProviderDispute, ProviderPayment, ProviderRefund } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';

type PaymentRow = ProviderPayment & {
  user: { id: string; username: string; email: string };
  refunds: Array<ProviderRefund & { ticket?: { matchId: string } | null }>;
  disputes: ProviderDispute[];
  checkout?: { match: { id: string; name: string; startsAt: Date }; _count: { tickets: number } } | null;
};

const paymentInclude = {
  user: { select: { id: true, username: true, email: true } },
  refunds: { orderBy: { createdAt: 'asc' }, include: { ticket: { select: { matchId: true } } } },
  disputes: { orderBy: { openedAt: 'asc' } },
  checkout: { select: { match: { select: { id: true, name: true, startsAt: true } }, _count: { select: { tickets: true } } } },
} as const;

/** Admin-only DTO: provider references are visible to platform admins only (DEC-014 pattern). */
export const toAdminPayment = (row: PaymentRow): AdminPayment => {
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
    purpose: row.purpose,
    ...(row.checkout && {
      match: { id: row.checkout.match.id, name: row.checkout.match.name, startsAt: row.checkout.match.startsAt.toISOString() },
      ticketCount: row.checkout._count.tickets,
    }),
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
      source: refund.source,
      ...(refund.ticketId ? { ticketId: refund.ticketId } : {}),
      ...(refund.ticket ? { matchId: refund.ticket.matchId } : {}),
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
  async payments(query: { status?: AdminPayment['status']; reference?: string }) {
    const rows = await prisma.providerPayment.findMany({
      where: {
        ...(query.status && { status: query.status }),
        ...(query.reference && { reference: query.reference }),
      },
      include: paymentInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toAdminPayment);
  }

  async payment(id: string) {
    const row = await prisma.providerPayment.findUnique({ where: { id }, include: paymentInclude });
    return row ? toAdminPayment(row) : null;
  }

  /**
   * CEO batch 5, item 6: one queue of refunds finance must act on (NEEDS_ATTENTION, FAILED or flagged for review),
   * with the contact email of a deleted account's closure refund (D2).
   */
  async refundsNeedingAttention(): Promise<AdminPayment[]> {
    const rows = await prisma.providerPayment.findMany({
      where: {
        refunds: {
          some: {
            OR: [
              { status: { in: ['NEEDS_ATTENTION', 'FAILED'] } },
              { reviewReason: { not: null }, status: { not: 'RESTORED_TO_WALLET' } },
            ],
          },
        },
      },
      include: paymentInclude,
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const closures = await prisma.accountDeletionRequest.findMany({
      where: { status: 'COMPLETED', userId: { in: rows.map(({ userId }) => userId) } },
      select: { id: true, userId: true, contactEmail: true },
    });
    return rows.map((row) => {
      const closure = closures.find(({ userId }) => userId === row.userId);
      return { ...toAdminPayment(row), ...(closure && { accountClosure: { requestId: closure.id, contactEmail: closure.contactEmail } }) };
    });
  }
}
