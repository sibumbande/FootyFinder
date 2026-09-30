import type { PublicMatchPreview } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FriendButton } from '@/features/social/components/FriendButton.js';
import { SocialPage } from '@/features/social/pages/SocialPage.js';
import { GuestMatchesPage } from './pages/GuestMatchesPage.js';

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
  format: 'FIVE_A_SIDE', feeCents: 8_000, currency: 'ZAR', rules: [], status: 'OPEN', joinability: { canJoin: true, reason: 'AVAILABLE' },
  capacity: { filled: 7, total: 14 }, positions: { filled: 6, total: 10 },
} as PublicMatchPreview;
vi.mock('./hooks/usePublic.js', () => ({ usePublicMatches: () => ({ data: [match], error: null }) }));

afterEach(cleanup);

describe('Guest browsing (Gate 9 / TKT-910)', () => {
  it('lists upcoming public matches with counts and the fee, and prompts to sign up', () => {
    render(<MemoryRouter initialEntries={['/matches']}><GuestMatchesPage /></MemoryRouter>);
    expect(screen.getByText('Friday Fives')).toBeTruthy();
    expect(screen.getByText('7 of 14 places left')).toBeTruthy();
    expect(screen.getByTestId('public-match-card').textContent).toMatch(/5-a-side · R\s?80/);
    expect(screen.getByRole('link', { name: 'Sign up to play' }).getAttribute('href')).toBe('/register?returnTo=%2Fmatches');
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
    expect(screen.getByRole('link', { name: 'Sign up to add friend' }).getAttribute('href')).toBe('/register?returnTo=%2Fplayers%2Fu1');
  });
});
