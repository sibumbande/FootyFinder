import type { Relationship, SocialPlayerCard } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMessageText } from './components/ChatMessageText.js';
import { FriendButton } from './components/FriendButton.js';
import { SocialPage } from './pages/SocialPage.js';

const mocks = vi.hoisted(() => ({
  relationship: undefined as Relationship | undefined,
  mutate: vi.fn(),
  blocks: [] as Array<{ id: string }>,
  discover: [] as SocialPlayerCard[],
  summary: { friends: 11, incomingRequests: 0, unreadConversations: 2 },
}));
vi.mock('./hooks/useSocial.js', () => ({
  useRelationship: () => ({ data: mocks.relationship }),
  useFriendAction: () => ({ mutate: mocks.mutate, isPending: false, error: null }),
  useBlocks: () => ({ data: mocks.blocks }),
  useSocialSummary: () => ({ data: mocks.summary }),
  useDiscover: () => ({ data: mocks.discover, isPending: false, error: null }),
  useFriends: () => ({ data: [], isPending: false, error: null }),
  useFriendRequests: () => ({ data: { incoming: [], outgoing: [] }, error: null }),
  useSocialSettings: () => ({ data: { friendRequestsEnabled: true }, isPending: false }),
  useUpdateSocialSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useMyTeamInvites: () => ({ data: [] }),
  useTeamInviteAction: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock('@/features/messaging/hooks/useMessaging.js', () => ({ useConversations: () => ({ data: [], isPending: false, error: null }) }));
vi.mock('@/features/teams/hooks/useTeams.js', () => ({ useMyTeams: () => ({ data: [] }) }));
vi.mock('@/features/auth/hooks/useAuth.js', () => ({ useAuth: () => ({ user: { id: 'me', onboardingComplete: true, teams: [] }, isPending: false }) }));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.relationship = undefined;
  mocks.blocks = [];
  mocks.discover = [];
});

describe('Social page (Gate 9 / TKT-902)', () => {
  it('matches the CEO layout: title, subtitle, four tabs with counts and a search box', () => {
    render(<MemoryRouter><SocialPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /social network/i })).toBeTruthy();
    expect(screen.getByText(/players, friends, and squads in your city/i)).toBeTruthy();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Discover', 'Friends(11)', 'Teams', 'DMs(2)']);
    expect(screen.getByPlaceholderText('Search profiles by name...')).toBeTruthy();
    expect(screen.getByText('No new profiles found.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /friends/i }));
    expect(screen.getByPlaceholderText('Search your friends...')).toBeTruthy();
  });
});

describe('FriendButton (CEO "friends everywhere")', () => {
  const renderButton = (relationship?: Relationship) => {
    mocks.relationship = relationship;
    return render(<FriendButton userId="u2" />);
  };
  it('shows nothing for yourself, blocked players or players with requests off', () => {
    expect(renderButton({ userId: 'u2', state: 'SELF' }).container.textContent).toBe('');
    cleanup();
    expect(renderButton({ userId: 'u2', state: 'UNAVAILABLE', blockedByYou: true }).container.textContent).toBe('');
  });
  it('sends, cancels, accepts and shows Friends', () => {
    renderButton({ userId: 'u2', state: 'CAN_REQUEST' });
    fireEvent.click(screen.getByRole('button', { name: /add friend/i }));
    expect(mocks.mutate).toHaveBeenCalledWith({ kind: 'send', userId: 'u2' });
    cleanup();
    renderButton({ userId: 'u2', state: 'REQUESTED', requestId: 'r1' });
    fireEvent.click(screen.getByRole('button', { name: 'Requested' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ kind: 'cancel', requestId: 'r1' });
    cleanup();
    renderButton({ userId: 'u2', state: 'INCOMING', requestId: 'r2' });
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ kind: 'accept', requestId: 'r2' });
    cleanup();
    renderButton({ userId: 'u2', state: 'FRIENDS' });
    expect(screen.getByTestId('friend-state').textContent).toContain('Friends');
  });
});

describe('Chat messages from blocked players (D10)', () => {
  it('hides the message until you choose to show it', () => {
    mocks.blocks = [{ id: 'blocked' }];
    render(<ChatMessageText senderId="blocked" content="rude words" className="" />);
    expect(screen.queryByText('rude words')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByText('rude words')).toBeTruthy();
    cleanup();
    render(<ChatMessageText senderId="someone" content="kick-off at 7" className="" />);
    expect(screen.getByText('kick-off at 7')).toBeTruthy();
  });
});
