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

vi.mock('@/features/venues/hooks/useVenues.js', () => ({
  useVenue: () => ({
    data: {
      venue: {
        name: 'Approved Arena',
        addressLine1: '1 Main Road',
        fields: [{ id: 'f03d12a0-9855-4a03-8948-739bad35e733', name: 'Field One' }],
      },
    },
  }),
}));

describe('CreateMatchPage', () => {
  it('persists match-specific capacity, rolling substitutions, and rules', () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/matches/new?venue=approved-arena&field=f03d12a0-9855-4a03-8948-739bad35e733&format=FIVE_A_SIDE&startsAt=2099-08-23T18%3A00%3A00.000Z&price=300000',
        ]}
      >
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
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create match' }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        feeCents: 8_000,
        managedFieldId: 'f03d12a0-9855-4a03-8948-739bad35e733',
        substituteCapacityPerTeam: 10,
        rollingSubstitutes: true,
        rules: ['GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'],
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
