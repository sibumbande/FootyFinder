import type { Match } from '@footy-finder/shared';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JoinMatchSheet } from './JoinMatchSheet.js';

const mocks = vi.hoisted(() => ({ props: null as null | { sides: string[]; place: unknown } }));
vi.mock('@/features/notifications/NotificationProvider.js', () => ({ useNotifications: () => ({ notify: vi.fn() }) }));
vi.mock('@/features/tickets/components/TicketConfirmSheet.js', () => ({
  TicketConfirmSheet: (props: { sides: string[]; place: unknown; notice: ReactNode }) => {
    mocks.props = props;
    return <div data-testid="ticket-confirm-sheet">{props.notice}</div>;
  },
}));

afterEach(() => {
  cleanup();
  mocks.props = null;
});

// Kickoff 30 Oct 2026 14:00 SAST -> go/no-go at 13:30 SAST (11:30Z).
const match = (overrides: Partial<Match> = {}) =>
  ({
    id: 'match-1',
    format: 'FIVE_A_SIDE',
    substituteCapacityPerTeam: 2,
    homeParticipantCount: 7,
    awayParticipantCount: 0,
    feeCents: 8_000,
    startsAt: '2026-10-30T12:00:00.000Z',
    ...overrides,
  }) as unknown as Match;
const renderSheet = (value: Match) => render(<MemoryRouter><JoinMatchSheet match={value} open onClose={() => undefined} /></MemoryRouter>);

describe('JoinMatchSheet (DEC-021 A1)', () => {
  it('buys a substitute ticket on a side with room, never a wallet payment', () => {
    renderSheet(match());
    expect(mocks.props?.place).toEqual({ seat: 'SUBSTITUTE' });
    expect(mocks.props?.sides).toEqual(['AWAY']);
    expect(screen.queryByText(/wallet/i)).toBeNull();
  });

  it('shows the T-30 rule with the computed time before the player pays (DEC-018)', () => {
    renderSheet(match({ goNoGoAt: '2026-10-30T11:30:00.000Z' }));
    expect(screen.getByTestId('join-go-no-go-notice')).toHaveTextContent(
      "This match goes ahead only if every position is filled and a FootyFinder referee is assigned by 13:30 (30 minutes before kickoff). If not, it's cancelled automatically and you choose a match credit or a full refund.",
    );
  });

  it('shows no go/no-go notice for a legacy match', () => {
    renderSheet(match());
    expect(screen.queryByTestId('join-go-no-go-notice')).not.toBeInTheDocument();
  });
});
