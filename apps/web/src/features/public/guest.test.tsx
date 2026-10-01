import type { PublicMatchPreview } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchListPage } from '@/features/matches/pages/MatchListPage.js';
import { FriendButton } from '@/features/social/components/FriendButton.js';
import { SocialPage } from '@/features/social/pages/SocialPage.js';
import { GuestMatchLobby } from './components/GuestMatchLobby.js';
import { GuestTeamPage } from './pages/GuestTeamPage.js';

vi.mock('@/features/auth/hooks/useAuth.js', () => ({ useAuth: () => ({ user: null, isPending: false }) }));
vi.mock('@/features/social/hooks/useSocial.js', async () => (await import('@/test/social-hooks-mock.js')).socialHooksMock);
vi.mock('@/features/social/hooks/useRecruitment.js', () => ({
  useRecruitmentPosts: () => ({ data: [], error: null }),
  useLookingPlayers: () => ({ data: [], error: null }),
  useRecruitmentAction: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
const match: PublicMatchPreview = {
  slug: 'm-0123456789abcdef01234567', canonicalUrl: 'https://footyfinder.test/m/m-0123456789abcdef01234567', name: 'Friday Fives',
  venue: { name: 'Italian Club', city: 'Cape Town', region: 'Western Cape' }, startsAt: '2099-01-01T16:00:00.000Z', durationMinutes: 60,
  format: 'FIVE_A_SIDE', feeCents: 8_000, currency: 'ZAR', freeOnFootyFinder: false, firstTimersOnly: false, rules: [], status: 'OPEN', joinability: { canJoin: true, reason: 'AVAILABLE' },
  capacity: { filled: 7, total: 14 }, positions: { filled: 6, total: 10 },
  sides: { home: { filled: 4, total: 5 }, away: { filled: 2, total: 5 } },
  goNoGoAt: '2099-01-01T15:30:00.000Z',
} as PublicMatchPreview;
const team = {
  id: 't1', name: 'Woodstock Wanderers', primaryFormat: 'FIVE_A_SIDE', closed: false, description: 'Sunday league',
  members: [{ userId: 'u1', displayName: 'Ayanda Mokoena', username: 'ayanda', role: 'OWNER', positions: ['MIDFIELDER'] }],
  record: { played: 3, wins: 2, draws: 1, losses: 0 }, reviews: { enoughReviews: false, averageRating: null, reviewCount: null },
};
vi.mock('./hooks/usePublic.js', () => ({
  usePublicMatches: () => ({ data: [match], error: null, isPending: false }),
  usePublicTeam: () => ({ data: team, error: null, isPending: false }),
}));

afterEach(cleanup);

describe('Guest browsing (Gate 9 / TKT-910)', () => {
  // CEO touch-up batch 2, item 5: guests get the member screens, with counts only and "Sign up to play".
  it('shows guests the member match list with counts and the fee, and Sign up to play instead of Create Match', () => {
    render(<MemoryRouter initialEntries={['/matches']}><MatchListPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Find your next game' })).toBeTruthy();
    expect(screen.getByText('Friday Fives')).toBeTruthy();
    expect(screen.getByText('7/14')).toBeTruthy();
    expect(screen.getByText(/R\s?80/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Create Match!' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Sign up to play' }).getAttribute('href')).toBe('/register?returnTo=%2Fmatches');
    expect(screen.getByRole('link', { name: 'View match' }).getAttribute('href')).toBe('/m/m-0123456789abcdef01234567');
  });

  it('shows guests the match lobby layout with filled counts per side and never a lineup', () => {
    render(<MemoryRouter initialEntries={['/m/m-0123456789abcdef01234567']}><GuestMatchLobby preview={match} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Friday Fives' })).toBeTruthy();
    expect(screen.getByTestId('guest-side-home').textContent).toContain('4 of 5');
    expect(screen.getByTestId('guest-side-away').textContent).toContain('2 of 5');
    expect(screen.getByRole('heading', { name: 'Lobby chat' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /join/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    const signUps = screen.getAllByRole('link', { name: 'Sign up to play' });
    expect(signUps.length).toBeGreaterThan(0);
    for (const link of signUps) expect(link.getAttribute('href')).toBe('/register?returnTo=%2Fm%2Fm-0123456789abcdef01234567');
  });

  it('shows guests the member team page layout with Sign up to play actions', () => {
    render(<MemoryRouter initialEntries={['/teams/t1']}><GuestTeamPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Woodstock Wanderers' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Team sections' }).textContent).toBe('overviewsquad');
    expect(screen.getByText('Sunday league')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'squad' }));
    expect(screen.getAllByRole('link', { name: 'Sign up to play' })).toHaveLength(2);
    expect(screen.queryByText(/wallet|invites|settings/i)).toBeNull();
  });

  it('shows the recruitment board to guests and a sign-up prompt on the other Social tabs', () => {
    render(<MemoryRouter initialEntries={['/social']}><SocialPage /></MemoryRouter>);
    expect(screen.getByTestId('sign-up-prompt').textContent).toContain('search players');
    fireEvent.click(screen.getByRole('tab', { name: /teams/i }));
    expect(screen.queryByTestId('sign-up-prompt')).toBeNull();
    expect(screen.getByText('No teams recruiting right now.')).toBeTruthy();
  });

  it('turns Add friend into a sign-up link that comes back to the same page', () => {
    render(<MemoryRouter initialEntries={['/players/u1']}><FriendButton userId="u1" /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Sign up to play' }).getAttribute('href')).toBe('/register?returnTo=%2Fplayers%2Fu1');
  });
});
