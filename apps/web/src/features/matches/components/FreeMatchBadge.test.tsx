import type { PublicMatchPreview } from '@footy-finder/shared';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { GuestMatchCard } from './MatchCard.js';

// CEO touch-up batch 3, item 5.
const preview = {
  slug: 'm-0123456789abcdef01234567', canonicalUrl: 'https://footyfinder.test/m/x', name: 'Launch night',
  venue: { name: 'Italian Club', city: 'Cape Town', region: 'Western Cape' }, startsAt: '2099-01-01T16:00:00.000Z', durationMinutes: 60,
  format: 'FIVE_A_SIDE', feeCents: 0, currency: 'ZAR', freeOnFootyFinder: true, firstTimersOnly: true, rules: [], status: 'OPEN',
  joinability: { canJoin: true, reason: 'AVAILABLE' }, substitutesPerTeam: 2, capacity: { filled: 2, total: 14 }, positions: { filled: 2, total: 10 },
  sides: { home: { filled: 1, total: 5 }, away: { filled: 1, total: 5 } },
} as PublicMatchPreview;

describe('free match badge', () => {
  it('labels a free match as on FootyFinder, with its first-timers rule, and never shows R80', () => {
    const { container } = render(<MemoryRouter><GuestMatchCard match={preview} /></MemoryRouter>);
    expect(screen.getByTestId('free-match-badge')).toHaveTextContent('Free match, on FootyFinder');
    expect(screen.getByText('First-time players only')).toBeInTheDocument();
    expect(screen.getByText('Free, on FootyFinder')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/R\s?80/);
  });
});
