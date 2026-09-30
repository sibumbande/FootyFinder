import type { TeamReviewSummary } from '@footy-finder/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let summary: TeamReviewSummary = { enoughReviews: false, averageRating: null, reviewCount: null, reviews: [] };
vi.mock('@/api/client.js', () => ({
  teamReviewsClient: { teamSummary: vi.fn(async () => ({ data: summary })), report: vi.fn() },
}));
const { TeamReviewsSection } = await import('./TeamReviewsSection.js');

const renderSection = (isMember = false) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamReviewsSection teamId="team-1" isMember={isMember} />
    </QueryClientProvider>,
  );

describe('TeamReviewsSection (Gate 8 / TKT-810, DEC-017)', () => {
  afterEach(cleanup);

  it('says "Not enough reviews." below three reviews', async () => {
    renderSection();
    expect(await screen.findByText('Not enough reviews.')).toBeInTheDocument();
  });

  it('shows the average, count and approved comments without authors; members can report', async () => {
    summary = {
      enoughReviews: true,
      averageRating: 4.3,
      reviewCount: 3,
      reviews: [
        { id: 'r1', rating: 5, text: 'Great hosts', createdAt: '2026-10-30T13:00:00.000Z' },
        { id: 'r2', rating: 4, text: null, createdAt: '2026-10-30T13:00:00.000Z' },
      ],
    };
    renderSection(true);
    expect(await screen.findByText(/4.3 out of 5/)).toBeInTheDocument();
    expect(screen.getByText('(3 reviews)')).toBeInTheDocument();
    expect(screen.getByText(/Great hosts/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Report' })).toHaveLength(2);
  });
});
