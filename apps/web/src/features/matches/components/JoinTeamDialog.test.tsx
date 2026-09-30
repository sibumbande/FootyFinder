import type { Match } from '@footy-finder/shared';
import { ApiError } from '@footy-finder/api-client';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JoinTeamDialog } from './JoinTeamDialog.js';

const mocks = vi.hoisted(() => ({ joinError: null as Error | null, balanceCents: 20_000 }));
vi.mock('@/features/auth/hooks/useAuth.js', () => ({ useAuth: () => ({ user: { balanceCents: mocks.balanceCents } }) }));
vi.mock('@/features/notifications/NotificationProvider.js', () => ({ useNotifications: () => ({ notify: vi.fn() }) }));
vi.mock('../hooks/useMatches.js', () => ({
  useJoinMatch: () => ({ mutate: vi.fn(), isPending: false, error: mocks.joinError }),
}));

afterEach(() => {
  cleanup();
  mocks.joinError = null;
  mocks.balanceCents = 20_000;
});

// Kickoff 30 Oct 2026 14:00 SAST -> go/no-go at 13:30 SAST (11:30Z).
const match = (goNoGoAt?: string) =>
  ({
    id: 'match-1',
    format: 'FIVE_A_SIDE',
    substituteCapacityPerTeam: 2,
    homeParticipantCount: 1,
    awayParticipantCount: 0,
    feeCents: 8_000,
    startsAt: '2026-10-30T12:00:00.000Z',
    goNoGoAt,
  }) as unknown as Match;

describe('JoinTeamDialog go/no-go notice (DEC-018)', () => {
  it('shows the T-30 rule with the computed time before the player pays', () => {
    render(<JoinTeamDialog match={match('2026-10-30T11:30:00.000Z')} open onClose={() => undefined} />);
    expect(screen.getByTestId('join-go-no-go-notice')).toHaveTextContent(
      "This match goes ahead only if every position is filled and a FootyFinder referee is assigned by 13:30 (30 minutes before kickoff). If not, it's cancelled automatically and your R80 is refunded to your wallet.",
    );
  });

  it('shows no go/no-go notice for a legacy match', () => {
    render(<JoinTeamDialog match={match(undefined)} open onClose={() => undefined} />);
    expect(screen.queryByTestId('join-go-no-go-notice')).not.toBeInTheDocument();
  });
});

describe('JoinTeamDialog insufficient balance (TKT-603)', () => {
  it('links to the wallet top-up with the shortfall (at least R50) and a way back', () => {
    mocks.balanceCents = 5_000;
    mocks.joinError = new ApiError(402, 'Insufficient balance.', 'INSUFFICIENT_BALANCE');
    render(
      <MemoryRouter>
        <JoinTeamDialog match={match(undefined)} open onClose={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/You need R\s?30,00 more/)).toBeInTheDocument();
    expect(screen.queryByText(/R500/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Top up wallet' })).toHaveAttribute(
      'href',
      '/wallet?amount=5000&returnTo=%2Fmatches%2Fmatch-1#top-up',
    );
  });
});
