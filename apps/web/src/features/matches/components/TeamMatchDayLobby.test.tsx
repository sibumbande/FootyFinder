import type { Match } from '@footy-finder/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TeamMatchDayLobby } from './TeamMatchDayLobby.js';
vi.mock('@/features/social/hooks/useSocial.js', async () => (await import('@/test/social-hooks-mock.js')).socialHooksMock);

const request = vi.hoisted(() => vi.fn());
vi.mock('@/features/auth/hooks/useAuth.js', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('./MatchResultPanel.js', () => ({ MatchResultPanel: () => null }));
vi.mock('@/features/tickets/hooks/useTickets.js', () => ({ useTicketContext: () => ({ data: undefined }), useBuyTicket: () => ({ mutate: vi.fn() }), useLeaveTicket: () => ({ mutate: vi.fn() }) }));
vi.mock('@/features/team-reviews/components/MatchReviewPanel.js', () => ({ MatchReviewPanel: () => null }));
vi.mock('@/features/chat/components/ChatPanel.js', () => ({
  ChatPanel: () => <div>Team chat panel</div>,
}));
vi.mock('@/features/notifications/NotificationProvider.js', () => ({
  useNotifications: () => ({ notify: vi.fn() }),
}));
vi.mock('@/features/teams/hooks/useTeams.js', () => ({
  useTeam: () => ({ data: null, isPending: false, error: null }),
}));
vi.mock('../hooks/useTeamMatchDay.js', () => ({
  useTeamMatchAvailability: () => ({
    data: {
      requestedAt: null,
      summary: { squadPool: 0, available: 0, maybe: 0, unavailable: 0, noResponse: 0 },
      rows: [],
    },
    error: null,
  }),
  useTeamMatchAvailabilityMutations: () => ({
    request: { mutate: request, isPending: false, error: null },
    updateMine: { mutate: vi.fn(), error: null },
  }),
  useTeamMatchLineup: () => ({ data: null, isPending: false, error: null }),
  useTeamMatchLineupMutations: () => ({}),
}));
vi.mock('../hooks/useMatches.js', () => ({
  useDeleteMatch: () => ({ mutate: vi.fn(), error: null }),
}));

const match: Match = {
  id: 'match-1',
  freeOnFootyFinder: false,
  firstTimersOnly: false,
  name: 'Private fixture',
  createdById: 'owner',
  mode: 'TEAM_MATCH',
  format: 'FIVE_A_SIDE',
  substituteCapacityPerTeam: 5,
  rollingSubstitutes: true,
  rules: [],
  visibility: 'PRIVATE',
  startsAt: '2099-09-01T18:00:00.000Z',
  durationMinutes: 60,
  matchEndsAt: '2099-09-01T19:00:00.000Z',
  feeCents: 0,
  currency: 'ZAR',
  status: 'DRAFT',
  participantCount: 0,
  homeParticipantCount: 0,
  awayParticipantCount: 0,
  formationVersion: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  venue: {
    id: 'venue-1',
    name: 'Arena',
    addressLine1: '1 Road',
    city: 'Cape Town',
    region: 'Western Cape',
    countryCode: 'ZA',
  },
  teamSides: [
    {
      id: 'side-1',
      matchId: 'match-1',
      teamId: 'team-1',
      side: 'HOME',
      organisingUserId: 'owner',
      formationKey: 'BALANCED_1_1_2_1',
      teamNameSnapshot: 'Footy FC',
    },
  ],
  viewerCanManage: true,
  viewerCanChat: true,
};

describe('TeamMatchDayLobby', () => {
  it('provides dedicated availability, lineup, and chat navigation', () => {
    render(
      <MemoryRouter>
        <TeamMatchDayLobby match={match} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Squad availability' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Request availability' }));
    expect(request).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'chat' }));
    expect(screen.getByText('Team chat panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'lineup' })).toBeInTheDocument();
  });
});
