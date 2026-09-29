import type { PublicVenueCard } from '@footy-finder/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { VenueCard } from './VenueCard.js';

afterEach(cleanup);

// A payload that still carries a (legacy) price field must not render it (DEC-018).
const venue = {
  slug: 'italian-club',
  name: 'Italian Club',
  city: 'Cape Town',
  region: 'Western Cape',
  coverImage: { url: 'https://example.invalid/cover.webp', altText: 'Cover', attribution: 'Test' },
  supportedFormats: ['FIVE_A_SIDE', 'SEVEN_A_SIDE', 'ELEVEN_A_SIDE'],
  fromPriceCents: 50_000,
} as PublicVenueCard;

describe('VenueCard', () => {
  it('never shows a venue cost, only the fixed player fee', () => {
    const { container } = render(
      <MemoryRouter>
        <VenueCard venue={venue} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Italian Club' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/From|500|field slot|VAT/);
    expect(container.textContent).toMatch(/R80 per player/);
  });
});
