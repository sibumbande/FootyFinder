import type { WalletLedgerEntry } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletPage } from './WalletPage.js';

const mocks = vi.hoisted(() => ({ summary: vi.fn(), history: vi.fn() }));
vi.mock('../components/TopUpForm.js', () => ({
  TopUpForm: ({ initialCents }: { initialCents?: number }) => <p>Top-up form {initialCents ?? 'default'}</p>,
}));
vi.mock('../hooks/useWallet.js', () => ({
  useWalletSummary: mocks.summary,
  useWalletHistory: mocks.history,
}));

const entry = (overrides: Partial<WalletLedgerEntry>): WalletLedgerEntry => ({
  id: crypto.randomUUID(),
  kind: 'TOP_UP',
  amountCents: 16_000,
  currency: 'ZAR',
  status: 'SUCCEEDED',
  countsTowardsBalance: true,
  title: 'Wallet top-up',
  createdAt: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <WalletPage />
    </MemoryRouter>,
  );

const history = (pages: WalletLedgerEntry[][], extra: Record<string, unknown> = {}) => ({
  isPending: false,
  error: null,
  data: { pages: pages.map((entries) => ({ entries, nextCursor: null })) },
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  ...extra,
});

afterEach(cleanup);

describe('WalletPage', () => {
  beforeEach(() => {
    mocks.summary.mockReturnValue({
      isPending: false,
      error: null,
      data: { balanceCents: 8_000, heldCents: 0, availableCents: 8_000, currency: 'ZAR', spendingRestricted: false },
    });
  });

  it('shows loading placeholders', () => {
    mocks.summary.mockReturnValue({ isPending: true, error: null, data: undefined });
    mocks.history.mockReturnValue({ isPending: true, error: null, data: undefined, hasNextPage: false });
    const { container } = renderPage();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows the empty state', () => {
    mocks.history.mockReturnValue(history([[]]));
    renderPage();
    expect(screen.getByText('No wallet activity yet.')).toBeInTheDocument();
  });

  it('shows errors', () => {
    mocks.history.mockReturnValue({ ...history([]), data: undefined, error: new Error('History unavailable') });
    renderPage();
    expect(screen.getByText('History unavailable')).toBeInTheDocument();
  });

  it('explains each credit and debit and links the related match', () => {
    const matchId = '11111111-1111-4111-8111-111111111111';
    mocks.history.mockReturnValue(
      history([
        [
          entry({ kind: 'MATCH_FEE', title: 'Match fee', amountCents: -8_000, related: { type: 'match', id: matchId, name: 'Sunday 7s' } }),
          entry({ title: 'Wallet top-up', amountCents: 16_000 }),
          entry({ title: 'Wallet top-up', amountCents: 50_000, status: 'FAILED', countsTowardsBalance: false }),
        ],
      ]),
    );
    renderPage();
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).getByText('Match fee')).toBeInTheDocument();
    expect(within(rows[0]!).getByLabelText(/Debit R\s?80,00/)).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('link', { name: 'Sunday 7s' })).toHaveAttribute('href', `/matches/${matchId}`);
    expect(within(rows[1]!).getByLabelText(/Credit R\s?160,00/)).toBeInTheDocument();
    expect(within(rows[2]!).getByText(/Failed – not charged/)).toBeInTheDocument();
    expect(screen.getByText(/cannot be withdrawn to a bank account/)).toBeInTheDocument();
  });

  it('loads the next page on request', () => {
    const fetchNextPage = vi.fn();
    mocks.history.mockReturnValue(history([[entry({})]], { hasNextPage: true, fetchNextPage }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it('warns when spending is restricted', () => {
    mocks.summary.mockReturnValue({
      isPending: false,
      error: null,
      data: { balanceCents: -8_000, heldCents: 0, availableCents: -8_000, currency: 'ZAR', spendingRestricted: true },
    });
    mocks.history.mockReturnValue(history([[]]));
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent(/Spending from your wallet is paused/);
  });

  it('passes a suggested amount to the top-up form and offers a safe way back to the match', () => {
    mocks.history.mockReturnValue(history([[]]));
    const matchId = '11111111-1111-4111-8111-111111111111';
    render(
      <MemoryRouter initialEntries={[`/wallet?amount=5000&returnTo=%2Fmatches%2F${matchId}`]}>
        <WalletPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Top-up form 5000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your match' })).toHaveAttribute('href', `/matches/${matchId}`);
  });

  it('ignores an unsafe return address', () => {
    mocks.history.mockReturnValue(history([[]]));
    render(
      <MemoryRouter initialEntries={['/wallet?returnTo=https%3A%2F%2Fevil.invalid']}>
        <WalletPage />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: 'Back to your match' })).not.toBeInTheDocument();
  });
});
