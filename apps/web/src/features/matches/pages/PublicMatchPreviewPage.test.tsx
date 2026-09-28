import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicMatchPreviewPage } from './PublicMatchPreviewPage.js';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  preview: vi.fn(),
  match: vi.fn(),
}));

vi.mock('@/features/auth/hooks/useAuth.js', () => ({ useAuth: mocks.auth }));
vi.mock('../hooks/useMatches.js', () => ({
  usePublicMatchPreview: mocks.preview,
  useMatchByPublicSlug: mocks.match,
}));
vi.mock('@/components/Logo.js', () => ({ Logo: () => <span>Footy Finder</span> }));
vi.mock('@/components/ThemeToggle.js', () => ({ ThemeToggle: () => null }));
vi.mock('../components/ShareMatchActions.js', () => ({ ShareMatchActions: () => <span>Share controls</span> }));
vi.mock('../components/JoinTeamDialog.js', () => ({ JoinTeamDialog: () => null }));

const preview = {
  slug: 'm-0123456789abcdef01234567',
  canonicalUrl: 'https://footy.example/m/m-0123456789abcdef01234567',
  name: 'Friday football',
  description: 'Friendly game',
  venue: { name: 'Queens Park', city: 'Cape Town', region: 'Western Cape' },
  startsAt: '2099-09-28T16:00:00.000Z',
  durationMinutes: 60,
  format: 'FIVE_A_SIDE',
  feeCents: 8_000,
  currency: 'ZAR',
  rules: [],
  status: 'OPEN',
  joinability: { canJoin: true, reason: 'AVAILABLE' },
  capacity: { filled: 7, total: 10 },
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/m/${preview.slug}`]}>
      <Routes>
        <Route path="/m/:slug" element={<PublicMatchPreviewPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  mocks.auth.mockReturnValue({ user: null, isPending: false });
  mocks.preview.mockReturnValue({ data: preview, isPending: false, error: null });
  mocks.match.mockReturnValue({ data: undefined, error: null });
});

describe('PublicMatchPreviewPage', () => {
  it('renders anonymous facts and preserves the same match through login and registration', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: preview.name })).toBeInTheDocument();
    expect(screen.getByText('7/10')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in to join' })).toHaveAttribute(
      'href',
      `/login?returnTo=%2Fm%2F${preview.slug}`,
    );
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      `/register?returnTo=%2Fm%2F${preview.slug}`,
    );
  });

  it('keeps a safe page without a join action when the match is full', () => {
    mocks.preview.mockReturnValue({
      data: { ...preview, status: 'FULL', joinability: { canJoin: false, reason: 'FULL' } },
      isPending: false,
      error: null,
    });
    mocks.auth.mockReturnValue({
      user: { id: 'user-1', emailVerified: true, onboardingComplete: true },
      isPending: false,
    });
    renderPage();

    expect(screen.getByText(/This match is full/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join this match' })).not.toBeInTheDocument();
  });
});
