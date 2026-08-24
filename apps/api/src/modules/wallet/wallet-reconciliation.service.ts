import type { WalletReconciliationIssue, WalletReconciliationReport } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';

export class WalletReconciliationService {
  async report(): Promise<WalletReconciliationReport> {
    const [wallets, ledgerGroups, transactionCount, payments] = await Promise.all([
      prisma.walletAccount.findMany({
        select: {
          id: true,
          userId: true,
          balanceCents: true,
          holds: { where: { status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { amountCents: true } },
        },
      }),
      prisma.walletTransaction.groupBy({ by: ['walletAccountId'], where: { status: 'SUCCEEDED' }, _sum: { amountCents: true } }),
      prisma.walletTransaction.count(),
      prisma.matchPayment.findMany({ select: { id: true, amountCents: true, walletTransaction: { select: { amountCents: true, status: true, type: true } } } }),
    ]);
    const ledgerByWallet = new Map(ledgerGroups.map((row) => [row.walletAccountId, row._sum.amountCents ?? 0]));
    const issues: WalletReconciliationIssue[] = [];
    let activeHoldCount = 0;
    for (const wallet of wallets) {
      const expected = ledgerByWallet.get(wallet.id) ?? 0;
      if (expected !== wallet.balanceCents)
        issues.push({ code: 'BALANCE_LEDGER_MISMATCH', walletAccountId: wallet.id, userId: wallet.userId, expectedCents: expected, actualCents: wallet.balanceCents });
      activeHoldCount += wallet.holds.length;
      const available = wallet.balanceCents - wallet.holds.reduce((sum, hold) => sum + hold.amountCents, 0);
      if (available < 0)
        issues.push({ code: 'NEGATIVE_AVAILABLE_BALANCE', walletAccountId: wallet.id, userId: wallet.userId, actualCents: available });
    }
    for (const payment of payments)
      if (payment.walletTransaction.status !== 'SUCCEEDED' || payment.walletTransaction.type !== 'MATCH_ENTRY_DEBIT' || payment.walletTransaction.amountCents !== -payment.amountCents)
        issues.push({ code: 'PAYMENT_LEDGER_MISSING', referenceId: payment.id, expectedCents: -payment.amountCents, actualCents: payment.walletTransaction.amountCents });
    return { generatedAt: new Date().toISOString(), walletCount: wallets.length, transactionCount, activeHoldCount, issueCount: issues.length, issues };
  }
}
