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

describe('Leaderboards tab (batch 5 brief, B3)', () => {
  it('shows three boards to guests in a strict order, each saying how ties are broken', async () => {
    mocks.leaderboard.mockImplementation(async (board: string, period: string) => ({
      data: { board, period, since: null, viewer: null, rows: board === 'goals' ? [row(1, 'a', 'Ayanda', 7), row(2, 'b', 'Bongani', 4), row(3, 'c', 'Chris', 4)] : [] },
    }));
    view();
    const goals = await screen.findByTestId('leaderboard-goals');
    expect(await within(goals).findByText('Ayanda')).toBeInTheDocument();
    expect(within(goals).getByLabelText('Place 2')).toBeInTheDocument();
    expect(within(goals).getByLabelText('Place 3')).toBeInTheDocument();
    expect(within(goals).getByText('Ranked by goals; ties go to fewer matches played, then most assists, then whoever got there first.')).toBeInTheDocument();
    expect(within(goals).getByRole('link', { name: 'Chris' })).toHaveAttribute('href', '/players/c');
    expect(screen.getByRole('heading', { name: 'Most matches played' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Most assists' })).toBeInTheDocument();
    expect(await within(screen.getByTestId('leaderboard-matches')).findByText('No results yet this month.')).toBeInTheDocument();
    expect(mocks.leaderboard).toHaveBeenCalledWith('goals', 'month');
    fireEvent.click(within(goals).getByRole('button', { name: 'All time' }));
    expect(mocks.leaderboard).toHaveBeenCalledWith('goals', 'all');
  });

  it('renders the player name in a box that takes the free width (the batch 4 zero-width bug)', async () => {
    mocks.leaderboard.mockImplementation(async (board: string, period: string) => ({
      data: { board, period, since: null, viewer: null, rows: [row(1, 'a', 'Ayanda Mthembu', 7)] },
    }));
    view();
    const name = (await within(screen.getByTestId('leaderboard-matches')).findAllByTestId('player-name'))[0]!;
    expect(name).toHaveTextContent('Ayanda Mthembu');
    // PlayerName never widens its box (w-0 + min-w-full); its wrapper must grow to the free space or it is 0px wide.
    expect(name.parentElement?.parentElement?.className).toMatch(/\bflex-1\b/);
  });

  it('on phones shows one board at a time behind Matches · Goals · Assists tabs', async () => {
    mocks.leaderboard.mockResolvedValue({ data: { board: 'matches', period: 'month', since: null, viewer: null, rows: [] } });
    view();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Matches', 'Goals', 'Assists']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('leaderboard-goals').className).toContain('hidden lg:block');
    fireEvent.click(tabs[1]!);
    expect(screen.getByTestId('leaderboard-goals').className).not.toContain('hidden');
    expect(screen.getByTestId('leaderboard-matches').className).toContain('hidden lg:block');
  });

  it("marks the viewer's row and shows their own position under the top 10 when outside it", async () => {
    mocks.user = { id: 'me' };
    mocks.leaderboard.mockResolvedValue({ data: { board: 'matches', period: 'month', since: null, rows: [row(1, 'a', 'Ayanda', 9)], viewer: row(14, 'me', 'Me', 1) } });
    view();
    const viewers = await screen.findAllByTestId('leaderboard-viewer');
    expect(viewers[0]).toHaveTextContent('Your position: 14th (1 match)');
  });
});
