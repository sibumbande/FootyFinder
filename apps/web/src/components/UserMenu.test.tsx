import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { UserMenu } from './UserMenu.js';

vi.mock('@/features/auth/hooks/useAuth.js', () => ({
  useAuth: () => ({
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      username: 'player-one',
      email: 'player@example.invalid',
      displayName: 'Player One',
      avatarUrl: null,
    },
  }),
  useLogout: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe('UserMenu', () => {
  it('links directly to the authenticated player profile', () => {
    render(
      <MemoryRouter>
        <UserMenu />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /player-one/i }));
    expect(screen.getByRole('menuitem', { name: 'My Profile' })).toHaveAttribute(
      'href',
      '/players/11111111-1111-4111-8111-111111111111',
    );
  });
});
