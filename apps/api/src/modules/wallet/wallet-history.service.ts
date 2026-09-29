import type {
  WalletHistoryQuery,
  WalletLedgerEntry,
  WalletLedgerKind,
  WalletLedgerPage,
  WalletSummary,
} from '@footy-finder/shared';
import type { WalletTransactionType } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../errors/app-error.js';

const KIND_BY_TYPE: Record<WalletTransactionType, WalletLedgerKind> = {
  DEPOSIT: 'TOP_UP',
  DEPOSIT_CREDIT: 'TOP_UP',
  MATCH_CREATE: 'LEGACY',
  MATCH_JOIN: 'MATCH_FEE',
  MATCH_ENTRY_DEBIT: 'MATCH_FEE',
  MATCH_CANCELLATION_CREDIT: 'MATCH_REFUND',
  PLAYER_CANCELLATION_FULL_CREDIT: 'LEAVE_CREDIT',
  PLAYER_CANCELLATION_PARTIAL_CREDIT: 'LEAVE_CREDIT',
  REPLACEMENT_CREDIT: 'REPLACEMENT_CREDIT',
  FIELD_BOOKING_DEBIT: 'FIELD_BOOKING',
};

const TITLE_BY_KIND: Record<WalletLedgerKind, string> = {
  TOP_UP: 'Wallet top-up',
  MATCH_FEE: 'Match fee',
  MATCH_REFUND: 'Match cancelled – fee refunded',
  LEAVE_CREDIT: 'Credit for leaving a match',
  REPLACEMENT_CREDIT: 'Credit after a replacement joined',
  FIELD_BOOKING: 'Field booking contribution',
  LEGACY: 'Wallet adjustment',
};

export const walletLedgerKind = (type: WalletTransactionType): WalletLedgerKind =>
  KIND_BY_TYPE[type] ?? 'LEGACY';

// Opaque keyset cursor over (createdAt DESC, id DESC).
const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
const decodeCursor = (cursor: string) => {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || Number.isNaN(createdAt.getTime()))
    throw new AppError(400, 'That history cursor is not valid.', 'WALLET_CURSOR_INVALID');
  return { createdAt, id };
};

export class WalletHistoryService {
  private async account(userId: string) {
    const account = await prisma.walletAccount.findUnique({ where: { userId } });
    if (!account) throw new AppError(404, 'Wallet account not found.', 'WALLET_NOT_FOUND');
    return account;
  }

  async summary(userId: string): Promise<WalletSummary> {
    const account = await this.account(userId);
    const held = await prisma.walletHold.aggregate({
      where: {
        walletAccountId: account.id,
        status: 'ACTIVE',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      _sum: { amountCents: true },
    });
    const heldCents = held._sum.amountCents ?? 0;
    return {
      balanceCents: account.balanceCents,
      heldCents,
      availableCents: account.balanceCents - heldCents,
      currency: 'ZAR',
      spendingRestricted: false,
    };
  }

  async history(userId: string, query: WalletHistoryQuery): Promise<WalletLedgerPage> {
    const account = await this.account(userId);
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await prisma.walletTransaction.findMany({
      where: {
        walletAccountId: account.id,
        ...(after && {
          OR: [
            { createdAt: { lt: after.createdAt } },
            { createdAt: after.createdAt, id: { lt: after.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: {
        id: true,
        type: true,
        amountCents: true,
        status: true,
        referenceType: true,
        referenceId: true,
        createdAt: true,
      },
    });
    const page = rows.slice(0, query.limit);
    const matches = await this.relatedMatches(page);
    const entries = page.map((row): WalletLedgerEntry => {
      const kind = walletLedgerKind(row.type);
      const match = matches.get(row.id);
      return {
        id: row.id,
        kind,
        amountCents: row.amountCents,
        currency: 'ZAR',
        status: row.status,
        countsTowardsBalance: row.status === 'SUCCEEDED',
        title: TITLE_BY_KIND[kind],
        createdAt: row.createdAt.toISOString(),
        ...(match && { related: { type: 'match' as const, id: match.id, name: match.name } }),
      };
    });
    const last = page.at(-1);
    return {
      entries,
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  /** Resolves each ledger row's own reference to its match. Only match id and name are read. */
  private async relatedMatches(
    rows: Array<{ id: string; referenceType: string | null; referenceId: string | null }>,
  ) {
    const idsFor = (type: string) =>
      rows.flatMap((row) => (row.referenceType === type && row.referenceId ? [row.referenceId] : []));
    const uuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
    const [payments, cancellations, reservations] = await Promise.all([
      prisma.matchPayment.findMany({
        where: { id: { in: idsFor('MATCH_PAYMENT').filter(uuid) } },
        select: { id: true, matchId: true },
      }),
      prisma.participantCancellation.findMany({
        where: { id: { in: idsFor('CANCELLATION').filter(uuid) } },
        select: { id: true, matchId: true },
      }),
      prisma.fieldReservation.findMany({
        where: { id: { in: idsFor('FIELD_RESERVATION').filter(uuid) } },
        select: { id: true, matchId: true },
      }),
    ]);
    const matchIdByReference = new Map<string, string>([
      ...idsFor('MATCH').filter(uuid).map((id) => [`MATCH:${id}`, id] as const),
      ...payments.map((row) => [`MATCH_PAYMENT:${row.id}`, row.matchId] as const),
      ...cancellations.map((row) => [`CANCELLATION:${row.id}`, row.matchId] as const),
      ...reservations.map((row) => [`FIELD_RESERVATION:${row.id}`, row.matchId] as const),
    ]);
    const matchIds = [...new Set(matchIdByReference.values())];
    const matches = matchIds.length
      ? await prisma.match.findMany({ where: { id: { in: matchIds } }, select: { id: true, name: true } })
      : [];
    const byId = new Map(matches.map((match) => [match.id, match]));
    const result = new Map<string, { id: string; name: string }>();
    for (const row of rows) {
      const matchId = matchIdByReference.get(`${row.referenceType}:${row.referenceId}`);
      const match = matchId ? byId.get(matchId) : undefined;
      if (match) result.set(row.id, match);
    }
    return result;
  }
}
