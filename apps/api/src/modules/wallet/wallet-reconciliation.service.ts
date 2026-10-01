import type { WalletReconciliationIssue, WalletReconciliationReport } from '@footy-finder/shared';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';

const STARTED = ['IN_PROGRESS', 'AWAITING_RESULT', 'COMPLETED'] as const;

/**
 * Read-only financial reconciliation. It never repairs data; every issue is for finance review.
 * Slice 5 wallet checks, plus Gate 6 (TKT-609): provider top-ups, card refunds, chargebacks,
 * reservations that went ahead, venue payables and settlement batches. Gate 7 (TKT-701): team
 * wallets, their links to personal wallets, and contribution provenance.
 */
export class WalletReconciliationService {
  async report(now = new Date()): Promise<WalletReconciliationReport> {
    const issues: WalletReconciliationIssue[] = [];
    const wallet = await this.wallets(issues);
    const providerPaymentCount = await this.topUps(issues, now);
    await this.refunds(issues);
    await this.disputes(issues);
    const payableCount = await this.payables(issues);
    const settlementBatchCount = await this.batches(issues);
    const teamWalletCount = await this.teamWallets(issues);
    await this.freeMatches(issues);
    return {
      generatedAt: now.toISOString(),
      ...wallet,
      providerPaymentCount,
      payableCount,
      settlementBatchCount,
      teamWalletCount,
      issueCount: issues.length,
      issues,
    };
  }

  /**
   * CEO touch-up batch 3, item 5: in a free match every payment is R0, every joined player has exactly one ACTIVE
   * promotional cover (FootyFinder's own ledger, never a wallet), and no cover stays ACTIVE for a player who left.
   */
  private async freeMatches(issues: WalletReconciliationIssue[]) {
    const matches = await prisma.match.findMany({
      where: { freeOnFootyFinder: true },
      select: {
        id: true,
        status: true,
        payments: { select: { id: true, amountCents: true } },
        participants: { select: { id: true, status: true, promotionalCost: { select: { id: true, status: true } } } },
      },
    });
    for (const match of matches) {
      for (const payment of match.payments)
        if (payment.amountCents !== 0) issues.push({ code: 'FREE_MATCH_PAYMENT_NOT_ZERO', referenceId: payment.id, expectedCents: 0, actualCents: payment.amountCents });
      for (const participant of match.participants) {
        const active = participant.promotionalCost?.status === 'ACTIVE';
        if (participant.status === 'JOINED' && match.status !== 'CANCELLED' && !active) issues.push({ code: 'FREE_MATCH_COVER_MISSING', referenceId: participant.id });
        if (active && (participant.status !== 'JOINED' || match.status === 'CANCELLED')) issues.push({ code: 'FREE_MATCH_COVER_WITHOUT_PLAYER', referenceId: participant.id });
      }
    }
  }

  private async wallets(issues: WalletReconciliationIssue[]) {
    const [wallets, ledgerGroups, transactionCount, payments, contributions] = await Promise.all([
      prisma.walletAccount.findMany({
        select: {
          id: true,
          userId: true,
          balanceCents: true,
          spendingRestrictedAt: true,
          holds: { where: { status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { amountCents: true } },
        },
      }),
      prisma.walletTransaction.groupBy({ by: ['walletAccountId'], where: { status: 'SUCCEEDED' }, _sum: { amountCents: true } }),
      prisma.walletTransaction.count(),
      prisma.matchPayment.findMany({ select: { id: true, amountCents: true, walletTransaction: { select: { amountCents: true, status: true, type: true } } } }),
      prisma.fundingContribution.findMany({ where: { status: 'CAPTURED' }, select: { id: true, amountCents: true } }),
    ]);
    const ledgerByWallet = new Map(ledgerGroups.map((row) => [row.walletAccountId, row._sum.amountCents ?? 0]));
    let activeHoldCount = 0;
    for (const wallet of wallets) {
      const expected = ledgerByWallet.get(wallet.id) ?? 0;
      if (expected !== wallet.balanceCents)
        issues.push({ code: 'BALANCE_LEDGER_MISMATCH', walletAccountId: wallet.id, userId: wallet.userId, expectedCents: expected, actualCents: wallet.balanceCents });
      activeHoldCount += wallet.holds.length;
      if (wallet.balanceCents < 0 && !wallet.spendingRestrictedAt)
        issues.push({ code: 'NEGATIVE_BALANCE_UNRESTRICTED', walletAccountId: wallet.id, userId: wallet.userId, actualCents: wallet.balanceCents });
      const available = wallet.balanceCents - wallet.holds.reduce((sum, hold) => sum + hold.amountCents, 0);
      // A chargeback may legitimately leave a restricted wallet below zero (DEC-011 / D5).
      if (available < 0 && !wallet.spendingRestrictedAt)
        issues.push({ code: 'NEGATIVE_AVAILABLE_BALANCE', walletAccountId: wallet.id, userId: wallet.userId, actualCents: available });
    }
    for (const payment of payments)
      if (payment.walletTransaction.status !== 'SUCCEEDED' || payment.walletTransaction.type !== 'MATCH_ENTRY_DEBIT' || payment.walletTransaction.amountCents !== -payment.amountCents)
        issues.push({ code: 'PAYMENT_LEDGER_MISSING', referenceId: payment.id, expectedCents: -payment.amountCents, actualCents: payment.walletTransaction.amountCents });
    if (contributions.length) {
      const bookingLedgers = await prisma.walletTransaction.findMany({
        where: { idempotencyKey: { in: contributions.map((item) => `booking-capture:${item.id}`) } },
        select: { idempotencyKey: true, amountCents: true, status: true, type: true },
      });
      const byKey = new Map(bookingLedgers.map((item) => [item.idempotencyKey, item]));
      for (const contribution of contributions) {
        const ledger = byKey.get(`booking-capture:${contribution.id}`);
        if (!ledger || ledger.status !== 'SUCCEEDED' || ledger.type !== 'FIELD_BOOKING_DEBIT' || ledger.amountCents !== -contribution.amountCents)
          issues.push({ code: 'BOOKING_CONTRIBUTION_LEDGER_MISSING', referenceId: contribution.id, expectedCents: -contribution.amountCents, actualCents: ledger?.amountCents });
      }
    }
    return { walletCount: wallets.length, transactionCount, activeHoldCount };
  }

  /** A card top-up is credited exactly when its ProviderPayment was verified and credited. */
  private async topUps(issues: WalletReconciliationIssue[], now: Date) {
    const payments = await prisma.providerPayment.findMany({
      select: {
        id: true, userId: true, amountCents: true, status: true, verifiedAt: true, createdAt: true, reviewReason: true,
        walletTransaction: { select: { status: true, amountCents: true, type: true } },
      },
    });
    const maxPendingMs = env.TOP_UP_MAX_PENDING_HOURS * 3_600_000;
    for (const payment of payments) {
      const ledger = payment.walletTransaction;
      const credited = ledger.status === 'SUCCEEDED';
      if (payment.status === 'SUCCEEDED' && (!credited || ledger.amountCents !== payment.amountCents || ledger.type !== 'DEPOSIT_CREDIT'))
        issues.push({ code: 'TOP_UP_SUCCEEDED_WITHOUT_CREDIT', userId: payment.userId, referenceId: payment.id, expectedCents: payment.amountCents, actualCents: credited ? ledger.amountCents : 0 });
      if (credited && (payment.status !== 'SUCCEEDED' || !payment.verifiedAt))
        issues.push({ code: 'TOP_UP_CREDIT_WITHOUT_VERIFIED_PAYMENT', userId: payment.userId, referenceId: payment.id, actualCents: ledger.amountCents });
      if (payment.status === 'REVIEW')
        issues.push({ code: 'TOP_UP_UNDER_REVIEW', userId: payment.userId, referenceId: payment.id, expectedCents: payment.amountCents, detail: payment.reviewReason ?? undefined });
      if (payment.status === 'INITIALIZED' && now.getTime() - payment.createdAt.getTime() > maxPendingMs + 3_600_000)
        issues.push({ code: 'TOP_UP_PENDING_TOO_LONG', userId: payment.userId, referenceId: payment.id, expectedCents: payment.amountCents });
    }
    // A Paystack deposit credit must always belong to a ProviderPayment.
    const orphanCredits = await prisma.walletTransaction.findMany({
      where: { provider: 'paystack', type: 'DEPOSIT_CREDIT', status: 'SUCCEEDED', providerPayment: null },
      select: { id: true, amountCents: true, walletAccount: { select: { userId: true } } },
    });
    for (const credit of orphanCredits)
      issues.push({ code: 'TOP_UP_CREDIT_WITHOUT_VERIFIED_PAYMENT', userId: credit.walletAccount.userId, referenceId: credit.id, actualCents: credit.amountCents, detail: 'no_provider_payment' });
    return payments.length;
  }

  private async refunds(issues: WalletReconciliationIssue[]) {
    const refunds = await prisma.providerRefund.findMany({
      include: {
        debitTransaction: { select: { amountCents: true, status: true, type: true } },
        restoreTransaction: { select: { amountCents: true, status: true, type: true } },
        providerPayment: { select: { id: true, userId: true, amountCents: true } },
      },
    });
    const committedByPayment = new Map<string, number>();
    for (const refund of refunds) {
      const { debitTransaction: debit, restoreTransaction: restore } = refund;
      if (debit.status !== 'SUCCEEDED' || debit.type !== 'TOP_UP_REFUND_DEBIT' || debit.amountCents !== -refund.amountCents)
        issues.push({ code: 'REFUND_LEDGER_MISMATCH', userId: refund.providerPayment.userId, referenceId: refund.id, expectedCents: -refund.amountCents, actualCents: debit.amountCents, detail: 'debit' });
      if (refund.status === 'RESTORED_TO_WALLET' && (!restore || restore.status !== 'SUCCEEDED' || restore.type !== 'TOP_UP_REFUND_RESTORE_CREDIT' || restore.amountCents !== refund.amountCents))
        issues.push({ code: 'REFUND_LEDGER_MISMATCH', userId: refund.providerPayment.userId, referenceId: refund.id, expectedCents: refund.amountCents, actualCents: restore?.amountCents, detail: 'restore' });
      if (refund.status === 'FAILED' || refund.reviewReason)
        issues.push({ code: 'REFUND_NEEDS_FINANCE', userId: refund.providerPayment.userId, referenceId: refund.id, expectedCents: refund.amountCents, detail: refund.reviewReason ?? refund.failureReason ?? 'failed' });
      if (refund.status !== 'RESTORED_TO_WALLET')
        committedByPayment.set(refund.providerPayment.id, (committedByPayment.get(refund.providerPayment.id) ?? 0) + refund.amountCents);
    }
    for (const refund of refunds) {
      const committed = committedByPayment.get(refund.providerPayment.id) ?? 0;
      if (committed > refund.providerPayment.amountCents) {
        issues.push({ code: 'REFUNDS_EXCEED_TOP_UP', userId: refund.providerPayment.userId, referenceId: refund.providerPayment.id, expectedCents: refund.providerPayment.amountCents, actualCents: committed });
        committedByPayment.delete(refund.providerPayment.id);
      }
    }
  }

  private async disputes(issues: WalletReconciliationIssue[]) {
    const disputes = await prisma.providerDispute.findMany({
      include: {
        debitTransaction: { select: { amountCents: true, status: true, type: true } },
        reversalTransaction: { select: { amountCents: true, status: true, type: true } },
        providerPayment: { select: { userId: true } },
      },
    });
    for (const dispute of disputes) {
      const { debitTransaction: debit, reversalTransaction: reversal } = dispute;
      if (debit.status !== 'SUCCEEDED' || debit.type !== 'CHARGEBACK_DEBIT' || debit.amountCents !== -dispute.amountCents)
        issues.push({ code: 'DISPUTE_LEDGER_MISMATCH', userId: dispute.providerPayment.userId, referenceId: dispute.id, expectedCents: -dispute.amountCents, actualCents: debit.amountCents, detail: 'debit' });
      if (dispute.status === 'WON' && (!reversal || reversal.status !== 'SUCCEEDED' || reversal.type !== 'CHARGEBACK_REVERSAL_CREDIT' || reversal.amountCents !== dispute.amountCents))
        issues.push({ code: 'DISPUTE_LEDGER_MISMATCH', userId: dispute.providerPayment.userId, referenceId: dispute.id, expectedCents: dispute.amountCents, actualCents: reversal?.amountCents, detail: 'reversal' });
    }
  }

  /**
   * DEC-018 / D1 / D4: a payable exists exactly for each confirmed go/no-go Quick Match that went
   * ahead, equal to its reservation's admin-only price snapshot. Legacy matches are listed apart.
   */
  private async payables(issues: WalletReconciliationIssue[]) {
    const payables = await prisma.venuePayable.findMany({
      select: {
        id: true, amountCents: true, matchId: true,
        reservation: { select: { status: true, priceCentsSnapshot: true } },
        match: { select: { status: true, confirmedAt: true } },
      },
    });
    for (const payable of payables) {
      if (payable.reservation.status !== 'CONFIRMED' || !payable.match.confirmedAt || !(STARTED as readonly string[]).includes(payable.match.status))
        issues.push({ code: 'PAYABLE_NOT_ELIGIBLE', referenceId: payable.id, actualCents: payable.amountCents, detail: `match_${payable.match.status.toLowerCase()}` });
      if (payable.amountCents !== payable.reservation.priceCentsSnapshot)
        issues.push({ code: 'PAYABLE_AMOUNT_MISMATCH', referenceId: payable.id, expectedCents: payable.reservation.priceCentsSnapshot, actualCents: payable.amountCents });
    }
    const unpaidMatches = await prisma.match.findMany({
      where: {
        // Gate 7: DEC-019 team matches owe their venue the same way.
        OR: [{ mode: 'QUICK_GAME' }, { mode: 'TEAM_MATCH', otherSideMode: { not: null } }],
        status: { in: [...STARTED] },
        fieldReservation: { is: { status: 'CONFIRMED' } },
        venuePayable: { is: null },
      },
      select: { id: true, goNoGoAt: true, confirmedAt: true, fieldReservation: { select: { priceCentsSnapshot: true } } },
    });
    for (const match of unpaidMatches)
      issues.push({
        code: match.goNoGoAt ? 'STARTED_MATCH_WITHOUT_PAYABLE' : 'LEGACY_RESERVATION_UNSETTLED',
        referenceId: match.id,
        expectedCents: match.fieldReservation?.priceCentsSnapshot,
        ...(match.goNoGoAt && !match.confirmedAt && { detail: 'started_without_confirmation' }),
      });
    return payables.length;
  }

  /**
   * Gate 7 (DEC-014, D7/D8): each team wallet equals its ledger; holds never exceed it; every
   * contribution or refund has an equal and opposite row in the member's own personal wallet;
   * the unspent contributions add up to the balance; a closed team holds no money.
   */
  private async teamWallets(issues: WalletReconciliationIssue[]) {
    const [accounts, ledgerGroups, linkedRows, orphanPersonal] = await Promise.all([
      prisma.teamWalletAccount.findMany({
        select: {
          id: true, teamId: true, balanceCents: true,
          team: { select: { archivedAt: true } },
          holds: { where: { status: 'ACTIVE' }, select: { amountCents: true } },
          transactions: {
            select: { id: true, type: true, amountCents: true, spentBy: { select: { amountCents: true } }, spends: { select: { amountCents: true } } },
          },
        },
      }),
      prisma.teamWalletTransaction.groupBy({ by: ['teamWalletAccountId'], _sum: { amountCents: true } }),
      prisma.teamWalletTransaction.findMany({
        where: { linkedWalletTransactionId: { not: null } },
        select: {
          id: true, type: true, amountCents: true, contributorUserId: true,
          account: { select: { teamId: true } },
          linkedWalletTransaction: { select: { type: true, amountCents: true, status: true, walletAccount: { select: { userId: true } } } },
        },
      }),
      prisma.walletTransaction.findMany({
        where: { type: { in: ['TEAM_CONTRIBUTION_DEBIT', 'TEAM_CONTRIBUTION_REFUND_CREDIT'] }, status: 'SUCCEEDED', teamWalletLink: null },
        select: { id: true, amountCents: true, walletAccount: { select: { userId: true } } },
      }),
    ]);
    const ledgerByAccount = new Map(ledgerGroups.map((row) => [row.teamWalletAccountId, row._sum.amountCents ?? 0]));
    for (const account of accounts) {
      const expected = ledgerByAccount.get(account.id) ?? 0;
      if (expected !== account.balanceCents)
        issues.push({ code: 'TEAM_BALANCE_LEDGER_MISMATCH', walletAccountId: account.id, referenceId: account.teamId, expectedCents: expected, actualCents: account.balanceCents });
      const held = account.holds.reduce((sum, hold) => sum + hold.amountCents, 0);
      if (account.balanceCents - held < 0)
        issues.push({ code: 'TEAM_NEGATIVE_AVAILABLE_BALANCE', walletAccountId: account.id, referenceId: account.teamId, actualCents: account.balanceCents - held });
      let unspent = 0;
      for (const row of account.transactions) {
        if (row.type === 'CONTRIBUTION_CREDIT') unspent += row.amountCents - row.spentBy.reduce((sum, spend) => sum + spend.amountCents, 0);
        else if (row.spends.reduce((sum, spend) => sum + spend.amountCents, 0) !== -row.amountCents)
          issues.push({ code: 'TEAM_PROVENANCE_MISMATCH', walletAccountId: account.id, referenceId: row.id, expectedCents: -row.amountCents, actualCents: row.spends.reduce((sum, spend) => sum + spend.amountCents, 0), detail: 'debit_allocation' });
      }
      if (unspent !== account.balanceCents)
        issues.push({ code: 'TEAM_PROVENANCE_MISMATCH', walletAccountId: account.id, referenceId: account.teamId, expectedCents: account.balanceCents, actualCents: unspent, detail: 'unspent_total' });
      if (account.team.archivedAt && (account.balanceCents !== 0 || held !== 0))
        issues.push({ code: 'TEAM_ARCHIVED_WITH_FUNDS', walletAccountId: account.id, referenceId: account.teamId, actualCents: account.balanceCents });
    }
    const personalType = { CONTRIBUTION_CREDIT: 'TEAM_CONTRIBUTION_DEBIT', CONTRIBUTION_REFUND_DEBIT: 'TEAM_CONTRIBUTION_REFUND_CREDIT', CLOSURE_REFUND_DEBIT: 'TEAM_CONTRIBUTION_REFUND_CREDIT' } as const;
    for (const row of linkedRows) {
      const personal = row.linkedWalletTransaction;
      const expectedType = personalType[row.type as keyof typeof personalType];
      if (!personal || personal.status !== 'SUCCEEDED' || personal.type !== expectedType
        || personal.amountCents !== -row.amountCents || personal.walletAccount.userId !== row.contributorUserId)
        issues.push({ code: 'TEAM_CONTRIBUTION_LINK_MISMATCH', userId: row.contributorUserId ?? undefined, referenceId: row.id, expectedCents: -row.amountCents, actualCents: personal?.amountCents, detail: 'team_row' });
    }
    for (const row of orphanPersonal)
      issues.push({ code: 'TEAM_CONTRIBUTION_LINK_MISMATCH', userId: row.walletAccount.userId, referenceId: row.id, actualCents: row.amountCents, detail: 'personal_row_without_team_row' });
    await this.teamMeters(issues);
    return accounts.length;
  }

  /**
   * Gate 7 / TKT-709 (DEC-019, D2): fill-meter money is held only while its match is undecided,
   * a meter never holds more than its team's fee, and a confirmed match captured exactly each
   * team's fee from that team's wallet.
   */
  private async teamMeters(issues: WalletReconciliationIssue[]) {
    const holds = await prisma.teamWalletHold.findMany({
      where: { status: { in: ['ACTIVE', 'CAPTURED'] } },
      select: {
        id: true, matchId: true, side: true, status: true, amountCents: true,
        account: { select: { id: true, teamId: true } },
        match: { select: { status: true, confirmedAt: true, teamSides: { select: { side: true, teamId: true, teamFeeCents: true } } } },
      },
    });
    const bySide = new Map<string, { matchId: string; side: string; teamId: string; accountId: string; held: number; captured: number; feeCents: number | null; confirmed: boolean }>();
    for (const hold of holds) {
      if (hold.status === 'ACTIVE' && (hold.match.status === 'CANCELLED' || hold.match.confirmedAt))
        issues.push({ code: 'TEAM_HOLD_ORPHANED', walletAccountId: hold.account.id, referenceId: hold.id, actualCents: hold.amountCents, detail: `match_${hold.match.status.toLowerCase()}` });
      const key = `${hold.matchId}:${hold.side}:${hold.account.teamId}`;
      const side = hold.match.teamSides.find((candidate) => candidate.side === hold.side && candidate.teamId === hold.account.teamId);
      const entry = bySide.get(key) ?? { matchId: hold.matchId, side: hold.side, teamId: hold.account.teamId, accountId: hold.account.id, held: 0, captured: 0, feeCents: side?.teamFeeCents ?? null, confirmed: Boolean(hold.match.confirmedAt) };
      if (hold.status === 'ACTIVE') entry.held += hold.amountCents;
      else entry.captured += hold.amountCents;
      bySide.set(key, entry);
    }
    for (const entry of bySide.values())
      if (entry.feeCents !== null && entry.held + entry.captured > entry.feeCents)
        issues.push({ code: 'TEAM_METER_OVERFUNDED', walletAccountId: entry.accountId, referenceId: entry.matchId, expectedCents: entry.feeCents, actualCents: entry.held + entry.captured, detail: entry.side.toLowerCase() });
    const confirmed = await prisma.match.findMany({
      where: { otherSideMode: { not: null }, confirmedAt: { not: null } },
      select: { id: true, teamSides: { select: { side: true, teamId: true, teamFeeCents: true } } },
    });
    for (const match of confirmed)
      for (const side of match.teamSides) {
        if (!side.teamId || side.teamFeeCents === null) continue;
        const captured = bySide.get(`${match.id}:${side.side}:${side.teamId}`)?.captured ?? 0;
        if (captured !== side.teamFeeCents)
          issues.push({ code: 'TEAM_FEE_CAPTURE_MISMATCH', referenceId: match.id, expectedCents: side.teamFeeCents, actualCents: captured, detail: side.side.toLowerCase() });
      }
  }

  private async batches(issues: WalletReconciliationIssue[]) {
    const batches = await prisma.venueSettlementBatch.findMany({
      where: { status: { not: 'CANCELLED' } },
      select: {
        id: true, status: true, payablesCents: true, adjustmentsCents: true, totalCents: true,
        payables: { select: { amountCents: true, status: true } },
        adjustments: { select: { amountCents: true } },
      },
    });
    for (const batch of batches) {
      const payablesCents = batch.payables.reduce((sum, payable) => sum + payable.amountCents, 0);
      const adjustmentsCents = batch.adjustments.reduce((sum, adjustment) => sum + adjustment.amountCents, 0);
      if (payablesCents !== batch.payablesCents || adjustmentsCents !== batch.adjustmentsCents || payablesCents + adjustmentsCents !== batch.totalCents)
        issues.push({ code: 'SETTLEMENT_TOTAL_MISMATCH', referenceId: batch.id, expectedCents: payablesCents + adjustmentsCents, actualCents: batch.totalCents });
      const expectedState = batch.status === 'PAID' ? 'PAID' : 'IN_BATCH';
      if (batch.payables.some((payable) => payable.status !== expectedState))
        issues.push({ code: 'SETTLEMENT_PAYABLE_STATE_MISMATCH', referenceId: batch.id, detail: `expected_${expectedState.toLowerCase()}` });
    }
    return batches.length;
  }
}
