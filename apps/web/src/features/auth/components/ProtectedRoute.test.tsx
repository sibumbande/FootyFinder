import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute.js';
vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({ isPending: false, isAuthenticated: false }),
}));
describe('ProtectedRoute', () => {
  it('redirects unauthenticated visitors to login with their full internal destination', async () => {
    const CurrentLocation = () => {
      const location = useLocation();
      return <p>{`${location.pathname}${location.search}${location.hash}`}</p>;
    };
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
});
