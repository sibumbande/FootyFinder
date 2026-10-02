import type { Match } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamMatchOtherSide } from './TeamMatchOtherSide.js';

const mocks = vi.hoisted(() => ({ load: vi.fn(), withdraw: vi.fn(), join: vi.fn(), teams: [] as unknown[] }));
const mutation = (mutate: ReturnType<typeof vi.fn>) => ({ mutate, mutateAsync: mutate, isPending: false, error: null });
/** Batch 5 brief, B2: confirmations are in-app dialogs, not window.confirm. */
const confirmInDialog = async (name: string) => fireEvent.click(within(await screen.findByTestId('confirm-dialog')).getByRole('button', { name }));
vi.mock('../hooks/useMatches.js', () => ({
  useLoadTeamIntoMatch: () => mutation(mocks.load),
  useWithdrawTeamFromMatch: () => mutation(mocks.withdraw),
  useJoinMatch: () => mutation(mocks.join),
  useLeaveMatch: () => mutation(vi.fn()),
  useClaimPosition: () => mutation(vi.fn()),
}));
vi.mock('@/features/teams/hooks/useTeams.js', () => ({ useMyTeams: () => ({ data: mocks.teams }) }));
vi.mock('@/features/auth/hooks/useAuth.js', () => ({ useAuth: () => ({ user: { id: 'viewer' } }) }));
vi.mock('@/features/notifications/NotificationProvider.js', () => ({ useNotifications: () => ({ notify: vi.fn() }) }));
vi.mock('@/features/tickets/hooks/useTickets.js', () => ({
  useBuyTicket: () => ({ mutate: mocks.join, isPending: false, error: null }),
  useTicketContext: () => ({ data: undefined }),
}));

const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
const base = {
  id: 'm1', format: 'ELEVEN_A_SIDE', status: 'OPEN', startsAt: future, goNoGoAt: new Date(new Date(future).getTime() - 1_800_000).toISOString(),
  feeCents: 8_000, participants: [], formationSlots: [],
  teamSides: [{ side: 'HOME', teamId: 'home-team', teamNameSnapshot: 'Rondebosch FC' }],
  otherSideMode: 'TEAMS_ONLY', otherSideTakenBy: null, viewerTeamSide: null, viewerManagedTeamSide: null,
} as unknown as Match;
const renderSide = (match: Partial<Match> = {}) =>
  render(<MemoryRouter><TeamMatchOtherSide match={{ ...base, ...match } as Match} /></MemoryRouter>);

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.teams = [{ id: 'away-team', name: 'Claremont United', viewerRole: 'CAPTAIN', archivedAt: null }];
});

describe('TeamMatchOtherSide (Gate 7 / TKT-707)', () => {
  it('lets a captain of another team load their team, showing their own fee first', () => {
    renderSide();
    fireEvent.click(screen.getByRole('button', { name: 'Load my team' }));
    expect(screen.getByTestId('load-team-fee')).toHaveTextContent('R880 (11 players) + R240 (3 subs) = R1,120');
    fireEvent.change(screen.getByLabelText(/Subs your team brings/), { target: { value: '1' } });
    expect(screen.getByTestId('load-team-fee')).toHaveTextContent('R880 (11 players) + R80 (1 sub) = R960');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and load my team' }));
    expect(mocks.load).toHaveBeenCalledWith({ teamId: 'away-team', substituteCount: 1 }, expect.anything());
  });

  it('refuses a team once players have joined an "Open to both" side, and never offers "Teams only" to players', () => {
    renderSide({
      otherSideMode: 'OPEN', otherSideTakenBy: 'INDIVIDUALS',
      participants: [{ id: 'p1', userId: 'someone', team: 'AWAY' }] as Match['participants'],
    });
    expect(screen.queryByRole('button', { name: 'Load my team' })).not.toBeInTheDocument();
    expect(screen.getByText(/Players have already joined the other side/)).toBeInTheDocument();
    cleanup();
    mocks.teams = [];
    renderSide();
    expect(screen.queryByRole('button', { name: /Join as a player/ })).not.toBeInTheDocument();
  });

  it('lets a player buy an R80 ticket on an open "Open to both" side, but not a home team member', () => {
    mocks.teams = [];
    renderSide({ otherSideMode: 'OPEN', venue: { name: 'Green Point', city: 'Cape Town' } } as Partial<Match>);
    fireEvent.click(screen.getByRole('button', { name: /Join as a player/ }));
    const sheet = screen.getByTestId('ticket-confirm-sheet');
    expect(sheet).toHaveTextContent('Substitute · Away side');
    const pay = within(sheet).getByRole('button', { name: /Pay R80/ });
    expect(pay).toBeDisabled();
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'I understand the cancellation policy' }));
    fireEvent.click(pay);
    expect(mocks.join).toHaveBeenCalledWith(
      { input: { seat: 'SUBSTITUTE', side: 'AWAY', method: 'PAYMENT', acceptPolicy: true }, idempotencyKey: expect.any(String) },
      expect.anything(),
    );
    cleanup();
    renderSide({ otherSideMode: 'OPEN', viewerTeamSide: 'HOME' });
    expect(screen.queryByRole('button', { name: /Join as a player/ })).not.toBeInTheDocument();
  });

  it('lets only the loading team withdraw itself before the lock', async () => {
    const taken = {
      otherSideTakenBy: 'TEAM' as const,
      teamSides: [...base.teamSides, { side: 'AWAY', teamId: 'away-team', teamNameSnapshot: 'Claremont United' }] as Match['teamSides'],
    };
    renderSide({ ...taken, viewerManagedTeamSide: 'AWAY' });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw my team' }));
    await confirmInDialog('Withdraw my team');
    await vi.waitFor(() => expect(mocks.withdraw).toHaveBeenCalled());
    cleanup();
    renderSide({ ...taken, viewerManagedTeamSide: 'HOME' });
    expect(screen.queryByRole('button', { name: 'Withdraw my team' })).not.toBeInTheDocument();
    cleanup();
    renderSide({ ...taken, viewerManagedTeamSide: 'AWAY', goNoGoAt: new Date(Date.now() - 1_000).toISOString() });
    expect(screen.queryByRole('button', { name: 'Withdraw my team' })).not.toBeInTheDocument();
  });
});
