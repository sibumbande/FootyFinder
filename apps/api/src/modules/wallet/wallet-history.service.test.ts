import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  id: string;
  walletAccountId: string;
  type: string;
  amountCents: number;
  status: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
};

const ids = {
  me: '11111111-1111-4111-8111-111111111111',
  other: '22222222-2222-4222-8222-222222222222',
  myWallet: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  otherWallet: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  match: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  payment: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};
const txId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const db = vi.hoisted(() => ({
  accounts: [] as Array<{ id: string; userId: string; balanceCents: number }>,
  rows: [] as Row[],
  heldCents: 0,
}));

const matchesWhere = (row: Row, where: Record<string, unknown>) => {
  if (row.walletAccountId !== where.walletAccountId) return false;
  const or = where.OR as Array<{ createdAt: Date | { lt: Date }; id?: { lt: string } }> | undefined;
  if (!or) return true;
  return or.some((clause) =>
    clause.createdAt instanceof Date
      ? row.createdAt.getTime() === clause.createdAt.getTime() && row.id < clause.id!.lt
      : row.createdAt < clause.createdAt.lt,
  );
};

vi.mock('../../database/prisma.js', () => ({
  prisma: {
    walletAccount: {
      findUnique: vi.fn(async ({ where }: { where: { userId: string } }) =>
        db.accounts.find((account) => account.userId === where.userId) ?? null,
      ),
    },
    walletHold: { aggregate: vi.fn(async () => ({ _sum: { amountCents: db.heldCents || null } })) },
    walletTransaction: {
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take: number }) =>
        db.rows
          .filter((row) => matchesWhere(row, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
          .slice(0, take),
      ),
    },
    matchPayment: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.includes(ids.payment) ? [{ id: ids.payment, matchId: ids.match }] : [],
      ),
    },
    participantCancellation: { findMany: vi.fn(async () => []) },
    fieldReservation: { findMany: vi.fn(async () => []) },
    match: {
      findMany: vi.fn(async () => [{ id: ids.match, name: 'Sunday 7s' }]),
    },
  },
}));

const { WalletHistoryService, walletLedgerKind } = await import('./wallet-history.service.js');
const { walletRouter } = await import('./wallet.routes.js');
const { errorHandler } = await import('../../middleware/error-handler.js');

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 10, minute));
const row = (n: number, overrides: Partial<Row>): Row => ({
  id: txId(n),
  walletAccountId: ids.myWallet,
  type: 'DEPOSIT_CREDIT',
  amountCents: 16_000,
  status: 'SUCCEEDED',
  referenceType: 'DEPOSIT',
  referenceId: null,
  createdAt: at(n),
  ...overrides,
});

const appFor = (userId: string) =>
  express()
    .use((_req, res, next) => {
      res.locals.authUserId = userId;
      next();
    })
    .use('/wallet', walletRouter)
    .use(errorHandler);

describe('WalletHistoryService', () => {
  beforeEach(() => {
    db.heldCents = 0;
    db.accounts = [
      { id: ids.myWallet, userId: ids.me, balanceCents: 16_000 - 8_000 + 8_000 },
      { id: ids.otherWallet, userId: ids.other, balanceCents: 99_900 },
    ];
    db.rows = [
      row(1, {}),
      row(2, { type: 'MATCH_ENTRY_DEBIT', amountCents: -8_000, referenceType: 'MATCH', referenceId: ids.match }),
      row(3, { type: 'MATCH_CANCELLATION_CREDIT', amountCents: 8_000, referenceType: 'MATCH_PAYMENT', referenceId: ids.payment }),
      row(4, { status: 'FAILED', amountCents: 50_000 }),
      row(5, { walletAccountId: ids.otherWallet, amountCents: 99_900 }),
    ];
  });

  it('maps every ledger type to a player-facing kind with its sign preserved', () => {
    expect(walletLedgerKind('DEPOSIT_CREDIT')).toBe('TOP_UP');
    expect(walletLedgerKind('MATCH_ENTRY_DEBIT')).toBe('MATCH_FEE');
    expect(walletLedgerKind('MATCH_CANCELLATION_CREDIT')).toBe('MATCH_REFUND');
    expect(walletLedgerKind('PLAYER_CANCELLATION_FULL_CREDIT')).toBe('LEAVE_CREDIT');
    expect(walletLedgerKind('PLAYER_CANCELLATION_PARTIAL_CREDIT')).toBe('LEAVE_CREDIT');
    expect(walletLedgerKind('REPLACEMENT_CREDIT')).toBe('REPLACEMENT_CREDIT');
    expect(walletLedgerKind('FIELD_BOOKING_DEBIT')).toBe('FIELD_BOOKING');
    expect(walletLedgerKind('MATCH_CREATE')).toBe('LEGACY');
  });

  it('returns newest first, pages with an opaque cursor and never repeats or skips a row', async () => {
    const service = new WalletHistoryService();
    const first = await service.history(ids.me, { limit: 2 });
    expect(first.entries.map((entry) => entry.id)).toEqual([txId(4), txId(3)]);
    expect(first.nextCursor).toBeTruthy();
    const second = await service.history(ids.me, { limit: 2, cursor: first.nextCursor! });
    expect(second.entries.map((entry) => entry.id)).toEqual([txId(2), txId(1)]);
    expect(second.nextCursor).toBeNull();
  });

  it('keeps signs, links matches and reconciles succeeded entries to the balance', async () => {
    const { entries } = await new WalletHistoryService().history(ids.me, { limit: 50 });
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    expect(byId.get(txId(2))).toMatchObject({ kind: 'MATCH_FEE', amountCents: -8_000, related: { type: 'match', id: ids.match, name: 'Sunday 7s' } });
    expect(byId.get(txId(3))).toMatchObject({ kind: 'MATCH_REFUND', amountCents: 8_000, related: { id: ids.match } });
    expect(byId.get(txId(4))).toMatchObject({ status: 'FAILED', countsTowardsBalance: false });
    const settled = entries.filter((entry) => entry.countsTowardsBalance).reduce((sum, entry) => sum + entry.amountCents, 0);
    const summary = await new WalletHistoryService().summary(ids.me);
    expect(settled).toBe(summary.balanceCents);
  });

  it('reports held and available amounts', async () => {
    db.heldCents = 4_000;
    await expect(new WalletHistoryService().summary(ids.me)).resolves.toEqual({
      balanceCents: 16_000,
      heldCents: 4_000,
      availableCents: 12_000,
      currency: 'ZAR',
      spendingRestricted: false,
    });
  });

  it('only ever reads the authenticated user wallet over HTTP', async () => {
    const response = await request(appFor(ids.me)).get(`/wallet/transactions?userId=${ids.other}&limit=50`);
    expect(response.status).toBe(200);
    const returned = response.body.data.entries.map((entry: { id: string }) => entry.id);
    expect(returned).not.toContain(txId(5));
    expect(returned).toHaveLength(4);
    const summary = await request(appFor(ids.me)).get('/wallet');
    expect(summary.body.data.balanceCents).toBe(16_000);
  });

  it('rejects invalid pagination input', async () => {
    expect((await request(appFor(ids.me)).get('/wallet/transactions?limit=51')).status).toBe(400);
    expect((await request(appFor(ids.me)).get('/wallet/transactions?limit=0')).status).toBe(400);
    const bad = await request(appFor(ids.me)).get('/wallet/transactions?cursor=not-a-cursor');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('WALLET_CURSOR_INVALID');
  });

  it('exposes no provider references, idempotency keys or venue data', async () => {
    const response = await request(appFor(ids.me)).get('/wallet/transactions?limit=50');
    expect(JSON.stringify(response.body)).not.toMatch(/providerReference|idempotencyKey|priceCents|venue|payable|beneficiary/i);
  });
});
