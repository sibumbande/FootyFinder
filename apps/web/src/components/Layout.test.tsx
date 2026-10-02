import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Layout } from './Layout.js';

vi.mock('@/features/auth/hooks/useAuth.js', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('./ThemeToggle.js', () => ({ ThemeToggle: () => null }));

afterEach(cleanup);

describe('guest header on Social pages', () => {
  it.each(['/social', '/social?tab=teams', '/social?tab=leaderboards'])('highlights Social, never Teams, on %s', (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/social" element={<p>Social page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const nav = screen.getAllByRole('navigation')[0]!;
    expect(within(nav).getByRole('link', { name: 'Social' })).toHaveClass('bg-brand-600');
    const teams = within(nav).getByRole('link', { name: 'Teams' });
    expect(teams).not.toHaveClass('bg-brand-600');
    expect(teams).not.toHaveAttribute('aria-current');
  });
});
