import type { PublicVenueCard } from '@footy-finder/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { VenueCarousel } from './VenueCarousel.js';

const venue = (slug: string): PublicVenueCard => ({
  slug, name: `Venue ${slug}`, city: 'Cape Town', region: 'Western Cape',
  coverImage: { url: `https://example.invalid/${slug}.webp`, altText: `Photo of ${slug}`, attribution: 'Test' }, supportedFormats: ['FIVE_A_SIDE'],
});

afterEach(cleanup);

// CEO touch-up batch 3, item 8.
describe('VenueCarousel', () => {
  it('is a keyboard-focusable swipe region with every venue as a link', () => {
    render(<MemoryRouter><VenueCarousel venues={[venue('a'), venue('b'), venue('c')]} /></MemoryRouter>);
    const region = screen.getByRole('region', { name: /Venues/ });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region.className).toContain('snap-x');
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('shows a single venue full width with no arrows', () => {
    render(<MemoryRouter><VenueCarousel venues={[venue('only')]} /></MemoryRouter>);
    expect(screen.getByRole('link').parentElement!.className).toContain('w-full');
    expect(screen.queryByRole('button', { name: /venues/ })).toBeNull();
  });
});
