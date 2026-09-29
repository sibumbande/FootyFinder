import type { Match } from '@footy-finder/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JoinTeamDialog } from './JoinTeamDialog.js';

vi.mock('@/features/auth/hooks/useAuth.js', () => ({ useAuth: () => ({ user: { balanceCents: 20_000 } }) }));
vi.mock('@/features/notifications/NotificationProvider.js', () => ({ useNotifications: () => ({ notify: vi.fn() }) }));
vi.mock('@/features/wallet/hooks/useWallet.js', () => ({ useAddFunds: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock('../hooks/useMatches.js', () => ({
  useJoinMatch: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

afterEach(cleanup);

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
      "This match goes ahead only if every position is filled by 13:30 (30 minutes before kickoff). If not, it's cancelled automatically and your R80 is refunded to your wallet.",
    );
  });

  it('shows no go/no-go notice for a legacy match', () => {
    render(<JoinTeamDialog match={match(undefined)} open onClose={() => undefined} />);
    expect(screen.queryByTestId('join-go-no-go-notice')).not.toBeInTheDocument();
  });
});
