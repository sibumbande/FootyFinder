import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamInvitePage } from './TeamInvitePage.js';

vi.mock('@/components/ThemeToggle.js', () => ({ ThemeToggle: () => <button>Theme</button> }));

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  status: 'ACTIVE' as 'ACTIVE' | 'EXPIRED',
  accept: vi.fn(),
}));

vi.mock('@/features/auth/hooks/useAuth.js', () => ({
  useAuth: () => ({ user: state.user, isPending: false }),
}));
vi.mock('@/features/notifications/NotificationProvider.js', () => ({
  useNotifications: () => ({ notify: vi.fn() }),
}));
vi.mock('../hooks/useTeams.js', () => ({
  useInspectTeamInvite: () => ({
    data: {
      team: {
        id: 'team-1',
        name: 'Footy FC',
        shortName: 'FFC',
        profileImageUrl: null,
        locationText: null,
        primaryFormat: 'FIVE_A_SIDE',
        primaryColor: null,
        secondaryColor: null,
        memberCount: 4,
        viewerRole: null,
        description: 'Join our squad.',
      },
      invitedBy: {
        id: 'owner',
        userId: 'owner',
        username: 'owner',
        displayName: 'Owner',
        avatarUrl: null,
        bio: null,
        preferredPositions: [],
        dominantFoot: null,
        homeArea: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      expiresAt: '2026-08-27T00:00:00.000Z',
      status: state.status,
    },
    isPending: false,
    error: null,
  }),
  useAcceptTeamInvite: () => ({ mutate: state.accept, isPending: false, error: null }),
}));

describe('TeamInvitePage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    state.user = null;
    state.status = 'ACTIVE';
    state.accept.mockReset();
  });

  const renderPage = () =>
    render(
      <MemoryRouter
        initialEntries={['/teams/invite/raw-token']}
      >
        <Routes>
          <Route path="/teams/invite/:token" element={<TeamInvitePage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('preserves the invite destination for login and registration', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /invited to Footy FC/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toContain(
      'returnTo=%2Fteams%2Finvite%2Fraw-token',
    );
    expect(screen.getByRole('link', { name: 'Create Account' }).getAttribute('href')).toContain(
      'returnTo=%2Fteams%2Finvite%2Fraw-token',
    );
  });

  it('requires an explicit authenticated action to join', () => {
    state.user = { id: 'member' };
    renderPage();
    expect(state.accept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Join Team' }));
    expect(state.accept).toHaveBeenCalledOnce();
  });

  it('shows an expired invitation without authentication or join controls', () => {
    state.status = 'EXPIRED';
    renderPage();
    expect(screen.getByText('This invitation is expired.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join Team' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
  });
});
