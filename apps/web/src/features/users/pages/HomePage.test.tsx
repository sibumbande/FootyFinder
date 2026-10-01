import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './HomePage.js';

const mocks = vi.hoisted(() => ({ venues: [] as unknown[] }));

vi.mock('@/features/auth/hooks/useAuth.js', () => ({ useAuth: () => ({ user: { displayName: 'Sam', username: 'sam' } }) }));
vi.mock('@/features/matches/hooks/useMatches.js', () => ({ useMatches: () => ({ data: [], isPending: false }) }));
vi.mock('@/features/venues/hooks/useVenues.js', () => ({ useVenues: () => ({ data: mocks.venues, isPending: false }) }));

afterEach(() => {
  cleanup();
  mocks.venues = [];
});

// CEO touch-up batch 1, item 2: players only ever see the R80 player fee, never a field price.
const NO_VENUE_COST = /VAT|field slot|catalogue|per-player fees|[Pp]rices?\b|dual-control/;

describe('HomePage venue wording', () => {
  it('tells players every match is R80 a player with a FootyFinder referee, and nothing about field prices', () => {
    const { container } = render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByText('Every match is R80 a player, with a FootyFinder referee.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(NO_VENUE_COST);
  });

  it('keeps the empty venue list free of internal approval and price wording', () => {
    const { container } = render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByText('No venues are open yet.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(NO_VENUE_COST);
  });
});
