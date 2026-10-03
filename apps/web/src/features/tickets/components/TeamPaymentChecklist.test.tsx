import type { Match, TeamPaymentRoster } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamPaymentChecklist } from './TeamPaymentChecklist.js';

const mocks = vi.hoisted(() => ({ roster: undefined as unknown, pay: vi.fn(), subs: vi.fn() }));
vi.mock('../hooks/useTickets.js', () => ({
  useTeamPaymentRoster: () => ({ isPending: false, error: null, data: mocks.roster }),
  usePayForTeammates: () => ({ mutate: mocks.pay, isPending: false, error: null, data: undefined }),
}));
vi.mock('@/features/matches/hooks/useMatches.js', () => ({
  useChangeTeamSubstitutes: () => ({ mutate: mocks.subs, isPending: false, error: null }),
}));

const match = {
  id: 'm1', otherSideMode: 'TEAMS_ONLY', viewerTeamSide: 'HOME', startsAt: '2026-10-30T12:00:00.000Z',
  teamSides: [{ side: 'HOME', substituteCount: 1 }],
} as unknown as Match;
const roster = (overrides: Partial<TeamPaymentRoster> = {}): TeamPaymentRoster => ({
  matchId: 'm1', side: 'HOME', teamName: 'Rondebosch FC', seats: 6, paidSeats: 3, placeFeeCents: 8_000, stillNeededCents: 24_000,
  alertAt: '2026-10-30T08:00:00.000Z', cutoffAt: '2026-10-30T10:00:00.000Z', open: true, viewerCreditsAvailable: 0, viewerCanManage: false,
  members: [
    { userId: 'u1', displayName: 'Me', lineupRole: 'STARTER', status: 'UNPAID', isMe: true },
    { userId: 'u2', displayName: 'Thabo', lineupRole: 'STARTER', status: 'PAID', paidByDisplayName: 'Thabo', isMe: false },
    { userId: 'u3', displayName: 'Sipho', lineupRole: 'STARTER', status: 'PAID', paidByDisplayName: 'Thabo', isMe: false },
    { userId: 'u4', displayName: 'Lwazi', lineupRole: 'SUBSTITUTE', status: 'UNPAID', isMe: false },
    { userId: 'u5', displayName: 'Ayanda', lineupRole: null, status: 'BEING_PAID', isMe: false },
    { userId: 'u6', displayName: 'Kagiso', lineupRole: null, status: 'UNPAID', isMe: false },
  ],
  ...overrides,
});
const renderChecklist = (url = '/matches/m1') =>
  render(<MemoryRouter initialEntries={[url]}><TeamPaymentChecklist match={match} /></MemoryRouter>);

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('TeamPaymentChecklist (DEC-021 A5)', () => {
  it('shows the named checklist, who paid, the progress and the T-4h / T-2h deadlines', () => {
    mocks.roster = roster();
    renderChecklist();
    expect(screen.getByTestId('team-payment-progress')).toHaveTextContent('3 of 6 paid · R240 still needed');
    expect(screen.getByTestId('team-payment-u3')).toHaveTextContent('Paid by Thabo');
    expect(screen.getByTestId('team-payment-u5')).toHaveTextContent('Being paid for');
    expect(screen.getByTestId('team-payment-deadline')).toHaveTextContent('by 10:00, your captain is alerted');
    expect(screen.getByTestId('team-payment-deadline')).toHaveTextContent('by 12:00 (2 hours before kick-off), the match is cancelled');
    expect(screen.queryByText(/wallet/i)).toBeNull();
  });

  it('pays for ticked teammates in one payment, only after the policy tick', () => {
    mocks.roster = roster();
    renderChecklist();
    fireEvent.click(screen.getByLabelText('Pay for Me'));
    fireEvent.click(screen.getByLabelText('Pay for Lwazi'));
    const pay = screen.getByRole('button', { name: 'Pay R160 for 2 players' });
    expect(pay).toBeDisabled();
    fireEvent.click(screen.getByLabelText('I understand the cancellation policy'));
    fireEvent.click(pay);
    expect(mocks.pay).toHaveBeenCalledWith(
      { input: { playerIds: ['u1', 'u4'], method: 'PAYMENT', acceptPolicy: true }, idempotencyKey: expect.stringMatching(/:PAYMENT$/) },
      expect.anything(),
    );
  });

  it('pre-ticks the unpaid lineup players from the alert link, and offers a credit for my own seat only', () => {
    mocks.roster = roster({ viewerCreditsAvailable: 2 });
    renderChecklist('/matches/m1?pay=home');
    expect(screen.getByLabelText('Pay for Me')).toBeChecked();
    expect(screen.getByLabelText('Pay for Lwazi')).toBeChecked();
    expect(screen.getByLabelText('Pay for Kagiso')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('I understand the cancellation policy'));
    fireEvent.click(screen.getByRole('button', { name: 'Use my match credit for my seat' }));
    expect(mocks.pay).toHaveBeenCalledWith({ input: { playerIds: ['u1'], method: 'CREDIT', acceptPolicy: true }, idempotencyKey: expect.any(String) }, expect.anything());
  });

  it('before an opponent is found nothing can be paid but a captain can change subs; after the cutoff, neither', () => {
    mocks.roster = roster({ open: false, closedReason: 'CUTOFF_PASSED', viewerCanManage: true });
    renderChecklist();
    expect(screen.getByTestId('team-payment-deadline')).toHaveTextContent('Payments closed at 12:00, 2 hours before kick-off.');
    expect(screen.queryByLabelText('Your subs')).toBeNull();
    cleanup();
    mocks.roster = roster({ open: false, closedReason: 'OPPONENT_NOT_FOUND', viewerCanManage: true });
    renderChecklist();
    expect(screen.getByTestId('team-payment-deadline')).toHaveTextContent('Payments open once the other side is taken.');
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.change(screen.getByLabelText('Your subs'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change subs' }));
    expect(mocks.subs).toHaveBeenCalledWith(3);
  });
});
