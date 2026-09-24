import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CreateMatchPage } from './CreateMatchPage.js';

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('../hooks/useMatches.js', () => ({
  useCreateMatch: () => ({
    mutate: mocks.mutate,
    isPending: false,
    error: null,
  }),
}));

describe('CreateMatchPage', () => {
  it('persists match-specific capacity, rolling substitutions, and rules', () => {
    render(
      <MemoryRouter>
        <CreateMatchPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: /Substitutes per team/ }), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Rolling substitutions/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Goalkeepers swap after every goal/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    fireEvent.change(screen.getByLabelText('Match name'), {
      target: { value: 'Friday football' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: /Green Point Arena/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    fireEvent.change(screen.getByLabelText('Match date'), { target: { value: '2099-08-23' } });
    fireEvent.click(screen.getByRole('button', { name: '18:00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create match' }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        substituteCapacityPerTeam: 10,
        rollingSubstitutes: true,
        rules: ['GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'],
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
