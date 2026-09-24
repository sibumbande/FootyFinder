import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { UserCard } from './UserCard.js';
describe('UserCard', () => {
  it('renders a database user and falls back to their username for the display name', () => {
    render(
      <MemoryRouter>
        <UserCard
          user={{
            id: '1',
            userId: '1',
            username: 'player_one',
            displayName: 'player_one',
            avatarUrl: null,
            bio: null,
            preferredPositions: [],
            dominantFoot: null,
            homeArea: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'player_one' })).toBeInTheDocument();
    expect(screen.getByText('@player_one')).toBeInTheDocument();
  });
});
