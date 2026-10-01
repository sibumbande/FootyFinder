import type { TeamDetail } from '@footy-finder/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamInvitePanel } from './TeamInvitePanel.js';

const mocks = vi.hoisted(() => ({ create: vi.fn(), revoke: vi.fn() }));
vi.mock('../hooks/useTeams.js', () => ({
  useTeamInvites: () => ({ data: [], error: null }),
  useTeamInviteMutations: () => ({
    create: { mutate: mocks.create, isPending: false, error: null },
    revoke: { mutate: mocks.revoke, isPending: false, error: null },
  }),
}));
vi.mock('@/features/notifications/NotificationProvider.js', () => ({ useNotifications: () => ({ notify: vi.fn() }) }));
vi.mock('@/features/social/components/InviteFriendsPanel.js', () => ({ InviteFriendsPanel: () => null }));
vi.mock('@/features/social/components/TeamRecruitmentPanel.js', () => ({ TeamRecruitmentPanel: () => null }));

const team = { id: 'team-1', viewerRole: 'OWNER' } as TeamDetail;
let linkNumber = 0;

beforeEach(() => {
  linkNumber = 0;
  mocks.create.mockImplementation((_: unknown, options: { onSuccess: (response: { data: { id: string; inviteUrl: string } }) => void }) => {
    linkNumber += 1;
    options.onSuccess({ data: { id: `invite-${linkNumber}`, inviteUrl: `https://footyfinder.test/teams/invite/token-${linkNumber}` } });
  });
  mocks.revoke.mockImplementation((_: string, options: { onSuccess: () => void }) => options.onSuccess());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'share');
});

describe('TeamInvitePanel (CEO batch 2, item 6)', () => {
  it('shows the new link on screen with Copy, and confirms with "Copied!"', async () => {
    render(<TeamInvitePanel team={team} />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite Player' }));
    expect(screen.getByLabelText('Invite link')).toHaveValue('https://footyfinder.test/teams/invite/token-1');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy' })));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://footyfinder.test/teams/invite/token-1');
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();
  });

  it('offers Share only where the phone share menu exists', () => {
    render(<TeamInvitePanel team={team} />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite Player' }));
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    cleanup();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    render(<TeamInvitePanel team={team} />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite Player' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://footyfinder.test/teams/invite/token-2' }));
  });

  it('replaces the link: the old one is revoked and a new one shown', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TeamInvitePanel team={team} />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite Player' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace link' }));
    expect(mocks.revoke).toHaveBeenCalledWith('invite-1', expect.anything());
    expect(screen.getByLabelText('Invite link')).toHaveValue('https://footyfinder.test/teams/invite/token-2');
  });
});
