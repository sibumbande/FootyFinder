import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeaderboardsTab } from './LeaderboardsTab.js';

const mocks = vi.hoisted(() => ({ user: null as { id: string } | null, leaderboard: vi.fn() }));
vi.mock('@/features/auth/hooks/useAuth.js', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/api/client.js', () => ({ publicClient: { leaderboard: mocks.leaderboard } }));

const row = (rank: number, userId: string, displayName: string, value: number) => ({ rank, userId, displayName, avatarUrl: null, value });
const view = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LeaderboardsTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  mocks.leaderboard.mockReset();
  mocks.user = null;
});

describe('Leaderboards tab (CEO batch 3.5, item 6)', () => {
  it('shows three boards to guests, with tied players sharing a place and "This month" first', async () => {
    mocks.leaderboard.mockImplementation(async (board: string, period: string) => ({
      data: { board, period, since: null, viewer: null, rows: board === 'goals' ? [row(1, 'a', 'Ayanda', 7), row(2, 'b', 'Bongani', 4), row(2, 'c', 'Chris', 4)] : [] },
    }));
    view();
    const goals = await screen.findByTestId('leaderboard-goals');
    expect(await within(goals).findByText('Ayanda')).toBeInTheDocument();
    expect(within(goals).getAllByLabelText('Place 2')).toHaveLength(2);
    expect(within(goals).getByRole('link', { name: 'Chris' })).toHaveAttribute('href', '/players/c');
    expect(screen.getByRole('heading', { name: 'Most matches played' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Most assists' })).toBeInTheDocument();
    expect(await within(screen.getByTestId('leaderboard-matches')).findByText('No results yet this month.')).toBeInTheDocument();
    expect(mocks.leaderboard).toHaveBeenCalledWith('goals', 'month');
    fireEvent.click(within(goals).getByRole('button', { name: 'All time' }));
    expect(mocks.leaderboard).toHaveBeenCalledWith('goals', 'all');
  });

  it("shows a signed-in player's own place under the list when they are outside the top 20", async () => {
    mocks.user = { id: 'me' };
    mocks.leaderboard.mockResolvedValue({ data: { board: 'matches', period: 'month', since: null, rows: [row(1, 'a', 'Ayanda', 9)], viewer: row(23, 'me', 'Me', 1) } });
    view();
    const viewers = await screen.findAllByTestId('leaderboard-viewer');
    expect(viewers[0]).toHaveTextContent('Your place: 23rd (1 match)');
  });
});
