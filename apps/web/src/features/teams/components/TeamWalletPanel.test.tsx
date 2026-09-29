import type { TeamDetail, TeamWalletSummary } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRands, TeamWalletPanel } from './TeamWalletPanel.js';

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  history: vi.fn(),
  holds: vi.fn(),
  contribute: vi.fn(),
  refund: vi.fn(),
}));
vi.mock('../hooks/useTeamWallet.js', () => ({
  useTeamWalletSummary: mocks.summary,
  useTeamWalletHistory: mocks.history,
  useTeamWalletHolds: mocks.holds,
  useContributeToTeam: () => ({ mutate: mocks.contribute, isPending: false, error: null }),
  useRefundTeamContribution: () => ({ mutate: mocks.refund, isPending: false, error: null }),
}));
vi.mock('@/features/notifications/NotificationProvider.js', () => ({ useNotifications: () => ({ notify: vi.fn() }) }));

const team = (viewerRole: TeamDetail['viewerRole']) => ({ id: 'team-1', name: 'Rondebosch FC', viewerRole }) as TeamDetail;
const wallet = (overrides: Partial<TeamWalletSummary> = {}): TeamWalletSummary => ({
  teamId: 'team-1',
  balanceCents: 150_000,
  heldCents: 112_000,
  availableCents: 38_000,
  currency: 'ZAR',
  viewerUnspentCents: 50_000,
  viewerRefundableCents: 38_000,
  viewerCanManage: false,
  viewerCanContribute: true,
  ...overrides,
});
const renderPanel = (role: TeamDetail['viewerRole']) =>
  render(
    <MemoryRouter>
      <TeamWalletPanel team={team(role)} />
    </MemoryRouter>,
  );

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.summary.mockReturnValue({ isPending: false, error: null, data: wallet() });
  mocks.history.mockReturnValue({
    isPending: false,
    error: null,
    data: { pages: [{ entries: [
      { id: 'e1', kind: 'CONTRIBUTION', amountCents: 50_000, currency: 'ZAR', title: 'Contribution', createdAt: '2026-10-01T10:00:00.000Z', contributor: { userId: 'u1', displayName: 'Thandi' } },
    ], nextCursor: null }] },
    hasNextPage: false,
  });
  mocks.holds.mockReturnValue({ data: [{ id: 'h1', match: { id: 'm1', name: 'Friday 11s', startsAt: '2026-10-02T17:00:00.000Z' }, side: 'HOME', amountCents: 112_000, createdAt: '2026-10-01T10:00:00.000Z' }] });
});

describe('TeamWalletPanel (Gate 7 / TKT-703)', () => {
  it('shows a member the balance, history with contributor names, and their own unspent money, but no holds', () => {
    renderPanel('MEMBER');
    expect(screen.getByText(/R\s?1\s?500,00/)).toBeInTheDocument();
    expect(screen.getByText(/Thandi/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Take back R\s?380,00/ })).toBeInTheDocument();
    expect(screen.queryByText('Friday 11s')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contribute' })).toBeInTheDocument();
  });

  it('shows owners and captains the money held for team matches', () => {
    renderPanel('CAPTAIN');
    expect(screen.getByRole('link', { name: 'Friday 11s' })).toHaveAttribute('href', '/matches/m1');
  });

  it('validates the amount, asks for confirmation, then contributes with an idempotency key', () => {
    renderPanel('MEMBER');
    const input = screen.getByLabelText(/Amount in rands/);
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Contribute' }));
    expect(screen.getByText(/Enter a whole rand amount from R\s?10,00/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Contribute' }));
    expect(screen.getByText(/Move R\s?200,00 from your wallet to the team wallet\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm contribution' }));
    expect(mocks.contribute).toHaveBeenCalledWith(
      { amountCents: 20_000, idempotencyKey: expect.any(String) },
      expect.anything(),
    );
  });

  it('hides contributing for a former member of a closed team', () => {
    mocks.summary.mockReturnValue({ isPending: false, error: null, data: wallet({ viewerCanContribute: false, viewerUnspentCents: 0 }) });
    renderPanel('MEMBER');
    expect(screen.queryByRole('button', { name: 'Contribute' })).not.toBeInTheDocument();
    expect(screen.queryByText('Your unspent contributions')).not.toBeInTheDocument();
  });

  it('parses whole rands only', () => {
    expect(parseRands('R 1,120')).toBe(112_000);
    expect(parseRands('10')).toBe(1_000);
    expect(parseRands('10.50')).toBeNull();
    expect(parseRands('abc')).toBeNull();
  });
});
