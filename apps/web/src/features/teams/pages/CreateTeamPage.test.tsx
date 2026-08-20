import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CreateTeamPage } from './CreateTeamPage.js';

vi.mock('../hooks/useTeams.js', () => ({
  useCreateTeam: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

describe('CreateTeamPage', () => {
  it('moves through identity, football setup, and review using shared presets', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <CreateTeamPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Footy Finder FC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Primary format')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /5v5/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Footy Finder FC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Team' })).toBeInTheDocument();
  });
});
