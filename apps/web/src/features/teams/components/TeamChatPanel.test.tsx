import type { TeamDetail } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamChatPanel } from './TeamChatPanel.js';

const mocks = vi.hoisted(() => ({ send: vi.fn(), read: vi.fn(), pages: [] as unknown[] }));
vi.mock('../hooks/useTeamChat.js', () => ({
  useTeamChat: () => ({ isPending: false, error: null, data: { pages: mocks.pages }, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() }),
  useSendTeamChatMessage: () => ({ mutate: mocks.send, isPending: false, error: null }),
  useMarkTeamChatRead: () => ({ mutate: mocks.read }),
}));
vi.mock('@/features/auth/hooks/useAuth.js', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));

const team = (archivedAt: string | null = null) => ({ id: 'team-1', name: 'Rondebosch FC', archivedAt }) as TeamDetail;
const message = (id: string, senderId: string, content: string, name: string) => ({
  id, teamId: 'team-1', senderId, content, createdAt: '2026-10-01T10:00:00.000Z', sender: { id: senderId, userId: senderId, username: name, displayName: name },
});

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  // The newest page comes first; each page is oldest-first.
  mocks.pages = [
    { messages: [message('m3', 'me', 'On my way', 'Me')], olderCursor: 'c1', unreadCount: 0 },
    { messages: [message('m1', 'u1', 'Kick-off 7pm', 'Thandi'), message('m2', 'u2', 'Bring bibs', 'Sipho')], olderCursor: null, unreadCount: 0 },
  ];
});

describe('TeamChatPanel (Gate 7 / TKT-711)', () => {
  it('shows the retained history oldest first, marks it read, and sends a message', () => {
    render(<TeamChatPanel team={team()} />);
    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items[0]).toContain('Kick-off 7pm');
    expect(items[2]).toContain('On my way');
    expect(items[2]).toContain('You');
    expect(mocks.read).toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('Message your team'), { target: { value: '  See you there ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(mocks.send).toHaveBeenCalledWith('See you there', expect.anything());
  });

  it('is read-only for a closed team', () => {
    render(<TeamChatPanel team={team('2026-10-01T10:00:00.000Z')} />);
    expect(screen.queryByPlaceholderText('Message your team')).not.toBeInTheDocument();
    expect(screen.getByText(/chat is read-only/)).toBeInTheDocument();
  });
});
