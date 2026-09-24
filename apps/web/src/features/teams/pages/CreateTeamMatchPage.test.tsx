import type { TeamDetail } from '@footy-finder/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CreateTeamMatchPage } from './CreateTeamMatchPage.js';

const mutate = vi.hoisted(() => vi.fn());
const owner = {
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
};
const team: TeamDetail = {
  id: 'team-1',
  name: 'Footy FC',
  primaryFormat: 'FIVE_A_SIDE',
  memberCount: 1,
  viewerRole: 'CAPTAIN',
  ownerUserId: 'owner',
  owner,
  members: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
vi.mock('../hooks/useTeams.js', () => ({
  useTeam: () => ({ data: team, isPending: false, error: null }),
  useCreateTeamMatch: () => ({ mutate, isPending: false, error: null }),
}));

describe('CreateTeamMatchPage', () => {
  it('submits a private free Team fixture payload without wallet fields', () => {
    render(
      <MemoryRouter
        initialEntries={['/teams/team-1/matches/new']}
      >
        <Routes>
          <Route path="/teams/:teamId/matches/new" element={<CreateTeamMatchPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /7v7/i }));
    fireEvent.change(screen.getByLabelText('Formation preset'), {
      target: { value: 'COMPACT_1_3_2_1' },
    });
    fireEvent.change(screen.getByLabelText('Substitutes per Team'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Match name'), {
      target: { value: 'Saturday Team Match' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getAllByRole('button', { name: /Arena|Park|Centre/i })[0]!);
    fireEvent.change(screen.getByLabelText('Match date'), { target: { value: '2099-09-01' } });
    fireEvent.click(screen.getAllByRole('button', { name: /^18:00$/i })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Organise Match' }));
    const input = mutate.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      name: 'Saturday Team Match',
      format: 'SEVEN_A_SIDE',
      formationKey: 'COMPACT_1_3_2_1',
      substituteCapacityPerTeam: 10,
      rollingSubstitutes: false,
    });
    expect(input).not.toHaveProperty('feeCents');
    expect(input).not.toHaveProperty('visibility');
  });
});
