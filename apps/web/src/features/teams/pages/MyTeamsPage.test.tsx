import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MyTeamsPage } from './MyTeamsPage.js';

vi.mock('../hooks/useTeams.js', () => ({
  useMyTeams: () => ({
    data: [
      {
        id: 'team-1',
        name: 'Footy FC',
        shortName: 'FFC',
        profileImageUrl: null,
        locationText: 'Johannesburg',
        primaryFormat: 'FIVE_A_SIDE',
        primaryColor: null,
        secondaryColor: null,
        memberCount: 8,
        viewerRole: 'OWNER',
      },
    ],
    isPending: false,
    error: null,
  }),
}));

describe('MyTeamsPage', () => {
  it('renders the authenticated user Team summary and create action', () => {
    render(
      <MemoryRouter>
        <MyTeamsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Your football clubs' })).toBeInTheDocument();
    expect(screen.getByText('Footy FC')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create Team' })).toHaveAttribute(
      'href',
      '/teams/create',
    );
  });
});
