import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute.js';
vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({ isPending: false, isAuthenticated: false }),
}));
describe('ProtectedRoute', () => {
  it('redirects unauthenticated visitors to login', async () => {
    render(
      <MemoryRouter initialEntries={['/']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<p>Private home</p>} />
          </Route>
          <Route path="/login" element={<p>Login page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Private home')).not.toBeInTheDocument();
  });
});
