import type { LookingCardView, RecruitmentPostView } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamsTab } from './components/TeamsTab.js';
import { availabilityLabel } from './recruitment-labels.js';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), posts: [] as RecruitmentPostView[], looking: [] as LookingCardView[], filters: [] as unknown[] }));
vi.mock('./hooks/useRecruitment.js', () => ({
  useRecruitmentPosts: (filters: unknown) => {
    mocks.filters.push(filters);
    return { data: mocks.posts, error: null };
  },
  useLookingPlayers: () => ({ data: mocks.looking, error: null }),
  useRecruitmentAction: () => ({ mutate: mocks.mutate, isPending: false, error: null }),
}));
vi.mock('./hooks/useSocial.js', async () => (await import('@/test/social-hooks-mock.js')).socialHooksMock);
vi.mock('@/features/auth/hooks/useAuth.js', () => ({ useAuth: () => ({ user: { id: 'me', teams: [{ id: 't1', name: 'Woodstock Wanderers', role: 'CAPTAIN' }] } }) }));

const post = (overrides: Partial<RecruitmentPostView> = {}): RecruitmentPostView => ({
  id: 'p1', team: { id: 't2', name: 'Observatory United' }, positions: ['GOALKEEPER'], playersWanted: 2, joinedCount: 0,
  format: 'SEVEN_A_SIDE', level: 'COMPETITIVE', days: [2, 4], times: ['EVENING'], area: 'Woodstock', note: 'Keeper wanted',
  status: 'OPEN', expiresAt: '2026-11-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z', expired: false,
  viewerCanManage: false, viewerIsMember: false, viewerRequest: null, ...overrides,
});

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.posts = [post()];
  mocks.looking = [];
  mocks.filters = [];
});

describe('Recruitment board (Gate 9 / TKT-909)', () => {
  it('lists teams recruiting with Ask to join, filters, and a post button for captains', () => {
    render(<MemoryRouter><TeamsTab query="" /></MemoryRouter>);
    expect(screen.getByText('Observatory United')).toBeTruthy();
    expect(screen.getByText(/2 players wanted · 7-a-side · Competitive/)).toBeTruthy();
    expect(screen.getByText(/Woodstock · Tue, Thu · Evenings/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ kind: 'ask', postId: 'p1' });
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'GOALKEEPER' } });
    expect(mocks.filters.at(-1)).toMatchObject({ position: 'GOALKEEPER' });
    expect(screen.getByRole('button', { name: /we're recruiting/i })).toBeTruthy();
  });

  it('shows Requested with a cancel, and nothing to ask on your own team', () => {
    mocks.posts = [post({ viewerRequest: { id: 'r1', status: 'PENDING' } }), post({ id: 'p2', viewerIsMember: true })];
    render(<MemoryRouter><TeamsTab query="" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Requested/ }));
    expect(mocks.mutate).toHaveBeenCalledWith({ kind: 'cancel-request', requestId: 'r1' });
    expect(screen.getByText('Your team')).toBeTruthy();
  });

  it('describes availability plainly', () => {
    expect(availabilityLabel([], [])).toBe('Any day · any time');
    expect(availabilityLabel([6, 0], ['MORNING'])).toBe('Sun, Sat · Mornings');
  });
});
