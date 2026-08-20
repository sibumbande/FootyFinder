import type { TeamDetail } from '@footy-finder/shared';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamFormationEditor } from './TeamFormationEditor.js';

const state = vi.hoisted(() => ({ role: 'MEMBER' as 'MEMBER' | 'CAPTAIN' }));
vi.mock('@/features/matches/components/formation/FormationBoard.js', () => ({
  FormationBoard: ({ isHost }: { isHost: boolean }) => (
    <div>Board mode: {isHost ? 'edit' : 'read only'}</div>
  ),
}));
vi.mock('../hooks/useTeams.js', () => ({
  useTeamFormation: () => ({
    data: {
      id: 'f1',
      teamId: 'team-1',
      format: 'FIVE_A_SIDE',
      formationKey: 'five-balanced',
      slots: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    isPending: false,
    error: null,
  }),
  useTeamFormationMutations: () => ({
    preset: { mutate: vi.fn(), error: null },
    slot: { mutateAsync: vi.fn(), error: null },
  }),
}));

const team = (): TeamDetail => ({
  id: 'team-1',
  name: 'Footy FC',
  primaryFormat: 'FIVE_A_SIDE',
  memberCount: 0,
  viewerRole: state.role,
  ownerUserId: 'owner',
  members: [],
  owner: {
    id: 'owner',
    userId: 'owner',
    username: 'owner',
    displayName: 'Owner',
    avatarUrl: null,
    bio: null,
    preferredPositions: [],
    dominantFoot: null,
    homeArea: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('TeamFormationEditor permissions', () => {
  beforeEach(() => {
    state.role = 'MEMBER';
  });
  it('renders a read-only formation for members', () => {
    render(<TeamFormationEditor team={team()} />);
    expect(screen.getByText('Board mode: read only')).toBeInTheDocument();
    expect(screen.queryByLabelText('Formation preset')).not.toBeInTheDocument();
  });
  it('allows captains to choose and edit a formation', () => {
    state.role = 'CAPTAIN';
    render(<TeamFormationEditor team={team()} />);
    expect(screen.getByText('Board mode: edit')).toBeInTheDocument();
    expect(screen.getByLabelText('Formation preset')).toBeInTheDocument();
  });
});
