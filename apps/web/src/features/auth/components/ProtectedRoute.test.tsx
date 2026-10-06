import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute.js';
const auth = vi.hoisted(() => ({
  current: { isPending: false, isAuthenticated: false, user: null } as {
    isPending: boolean;
    isAuthenticated: boolean;
    user: null | { emailVerificationRequired: boolean; emailVerified: boolean; onboardingComplete: boolean };
  },
}));
vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => auth.current,
}));
const CurrentLocation = () => {
  const location = useLocation();
  return <p>{`${location.pathname}${location.search}${location.hash}`}</p>;
};
describe('ProtectedRoute', () => {
  it('redirects unauthenticated visitors to login with their full internal destination', async () => {
    auth.current = { isPending: false, isAuthenticated: false, user: null };
    render(
      <MemoryRouter
        initialEntries={['/matches/fixture-1?team=HOME#formation']}
      >
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/matches/:id" element={<p>Private match</p>} />
          </Route>
          <Route path="/login" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByText(
        '/login?returnTo=%2Fmatches%2Ffixture-1%3Fteam%3DHOME%23formation',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Private match')).not.toBeInTheDocument();
  });

  it('sends a new unverified account to verification with the intended destination', async () => {
    auth.current = {
      isPending: false,
      isAuthenticated: true,
      user: { emailVerificationRequired: true, emailVerified: false, onboardingComplete: false },
    };
    render(
      <MemoryRouter initialEntries={['/matches/fixture-1?team=AWAY']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/matches/:id" element={<p>Private match</p>} />
          </Route>
          <Route path="/verify-email" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('/verify-email?returnTo=%2Fmatches%2Ffixture-1%3Fteam%3DAWAY')).toBeInTheDocument();
  });

  it('sends a verified incomplete account to resumable onboarding', async () => {
    auth.current = {
      isPending: false,
      isAuthenticated: true,
      user: { emailVerificationRequired: true, emailVerified: true, onboardingComplete: false },
    };
    render(
      <MemoryRouter initialEntries={['/tickets']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/tickets" element={<p>Tickets</p>} />
          </Route>
          <Route path="/onboarding" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('/onboarding?returnTo=%2Ftickets')).toBeInTheDocument();
  });

  it('preserves legacy read access while server-side mutation gates require completion', async () => {
    auth.current = {
      isPending: false,
      isAuthenticated: true,
      user: { emailVerificationRequired: false, emailVerified: false, onboardingComplete: false },
    };
    render(
      <MemoryRouter initialEntries={['/matches/fixture-1']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/matches/:id" element={<p>Private match</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Private match')).toBeInTheDocument();
  });
});
