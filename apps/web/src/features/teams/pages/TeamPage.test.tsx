import type { TeamDetail } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamPage } from './TeamPage.js';
vi.mock('@/features/social/hooks/useSocial.js', async () => (await import('@/test/social-hooks-mock.js')).socialHooksMock);

const state = vi.hoisted(() => ({ role: 'OWNER' as 'OWNER' | 'CAPTAIN' | 'MEMBER' }));
const user = (id: string, displayName: string) => ({
  id,
  userId: id,
  username: id,
  displayName,
  avatarUrl: null,
  bio: null,
  preferredPositions: [],
  dominantFoot: null,
  homeArea: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const team: TeamDetail = {
  id: 'team-1',
  name: 'Footy FC',
  shortName: 'FFC',
  description: 'A proper squad.',
  profileImageUrl: null,
  locationText: 'Johannesburg',
  primaryFormat: 'FIVE_A_SIDE',
  primaryColor: null,
  secondaryColor: null,
  memberCount: 2,
  viewerRole: 'OWNER',
  ownerUserId: 'owner',
  owner: user('owner', 'Owner'),
  members: [
    {
      id: 'm-owner',
      teamId: 'team-1',
      userId: 'owner',
      role: 'OWNER',
      joinedAt: '2026-01-01T00:00:00.000Z',
      user: user('owner', 'Owner'),
    },
    {
      id: 'm-member',
      teamId: 'team-1',
      userId: 'member',
      role: 'MEMBER',
      joinedAt: '2026-01-02T00:00:00.000Z',
      user: user('member', 'Member'),
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

vi.mock('../hooks/useTeamSocket.js', () => ({ useTeamSocket: vi.fn() }));
vi.mock('@/features/social/components/FriendButton.js', () => ({ FriendButton: () => null }));
vi.mock('@/features/team-reviews/components/TeamReviewsSection.js', () => ({ TeamReviewsSection: () => null }));
vi.mock('@/features/notifications/NotificationProvider.js', () => ({
  useNotifications: () => ({ notify: vi.fn() }),
}));
vi.mock('../hooks/useTeams.js', () => ({
  useTeam: () => ({ data: { ...team, viewerRole: state.role }, isPending: false, error: null }),
  useTeamMemberMutation: () => ({
    role: { mutate: vi.fn(), error: null },
    remove: { mutate: vi.fn(), error: null },
  }),
  useUpdateTeam: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useUploadTeamImage: () => ({ mutate: vi.fn(), error: null }),
  useDeleteTeam: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

const renderPage = () =>
  render(
    <MemoryRouter
      initialEntries={['/teams/team-1']}
    >
      <Routes>
        <Route path="/teams/:teamId" element={<TeamPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('TeamPage role controls', () => {
  afterEach(cleanup);

  beforeEach(() => {
    state.role = 'OWNER';
  });

  it('shows owner-only settings and member management controls to the owner', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: 'settings' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'squad' }));
    expect(screen.getByRole('button', { name: 'Promote' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('does not expose invite, settings, or roster administration to a member', () => {
    state.role = 'MEMBER';
    renderPage();
    expect(screen.queryByRole('tab', { name: 'invites' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'settings' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'squad' }));
    expect(screen.queryByRole('button', { name: 'Promote' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});
