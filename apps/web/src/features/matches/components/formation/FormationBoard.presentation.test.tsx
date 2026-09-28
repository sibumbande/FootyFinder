import type { PublicUser } from '@footy-finder/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QUICK_MATCH_RESERVE_LABELS,
  QUICK_MATCH_SIDE_BADGES,
  QUICK_MATCH_SIDE_LABELS,
} from '../../constants/quick-match-sides.js';
import {
  FormationBoard,
  shortName,
  type FormationBoardPlayer,
  type FormationBoardSlot,
} from './FormationBoard.js';

const user = (id: string, displayName: string): PublicUser => ({
  id,
  userId: id,
  username: id,
  displayName,
  avatarUrl: null,
  bio: null,
  preferredPositions: [],
  dominantFoot: null,
  homeArea: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const me: FormationBoardPlayer = { id: 'me', team: 'HOME', user: user('me', 'Sibu Mbande') };
const striker: FormationBoardPlayer = {
  id: 'striker',
  team: 'AWAY',
  user: user('striker', 'Bartholomew-Alexander Jones'),
};
const benched: FormationBoardPlayer = { id: 'bench', team: 'AWAY', user: user('bench', 'Lee') };

const slots: FormationBoardSlot[] = [
  { id: 'a1', team: 'HOME', slotIndex: 1, positionX: 50, positionY: 80, playerId: 'me', player: me },
  { id: 'a2', team: 'HOME', slotIndex: 2, positionX: 30, positionY: 70, playerId: null },
  {
    id: 'b1',
    team: 'AWAY',
    slotIndex: 1,
    positionX: 50,
    positionY: 20,
    playerId: 'striker',
    player: striker,
  },
];

const renderQuickBoard = () =>
  render(
    <FormationBoard
      slots={slots}
      players={[me, striker, benched]}
      canEdit={false}
      onAssign={vi.fn()}
      onRemove={vi.fn()}
      onMove={vi.fn()}
      currentPlayerId="me"
      sideLabels={QUICK_MATCH_SIDE_LABELS}
      sideBadges={QUICK_MATCH_SIDE_BADGES}
      reserveLabels={QUICK_MATCH_RESERVE_LABELS}
      emptySlotsAreOpen
    />,
  );

afterEach(cleanup);

describe('FormationBoard Team A / Team B presentation', () => {
  it('names each side in text so it is never identified by colour alone', () => {
    renderQuickBoard();

    expect(screen.getByRole('button', { name: /^Team A position 1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Team B position 1/ })).toBeInTheDocument();
    const badges = screen.getAllByTestId('formation-side-badge').map((badge) => badge.textContent);
    expect(badges.sort()).toEqual(['A', 'A', 'B']);
    expect(screen.getByRole('heading', { name: /Team A reserves/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Team B reserves/ })).toBeInTheDocument();
  });

  it('states open and occupied positions explicitly', () => {
    renderQuickBoard();

    const open = screen.getByRole('button', { name: 'Team A position 2, open' });
    expect(within(open).getByText('OPEN')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Team B position 1, occupied by Bartholomew-Alexander Jones',
      }),
    ).toBeInTheDocument();
  });

  it('shows a readable short name beside each assigned marker', () => {
    renderQuickBoard();

    const occupied = screen.getByRole('button', { name: /Team B position 1, occupied/ });
    expect(within(occupied).getByText('Bartholomew…')).toBeInTheDocument();
    expect(shortName('Sibu Mbande')).toBe('Sibu');
    expect(shortName('Lee')).toBe('Lee');
  });

  it('emphasises the current user on the pitch and in the reserves', () => {
    const { rerender } = renderQuickBoard();

    const mine = screen.getByRole('button', { name: 'Team A position 1, occupied by Sibu Mbande (you)' });
    expect(mine).toHaveClass('formation-marker--current');
    expect(within(mine).getByText('You')).toBeInTheDocument();

    rerender(
      <FormationBoard
        slots={slots}
        players={[me, striker, benched]}
        canEdit={false}
        onAssign={vi.fn()}
        onRemove={vi.fn()}
        onMove={vi.fn()}
        currentPlayerId="bench"
        sideLabels={QUICK_MATCH_SIDE_LABELS}
        sideBadges={QUICK_MATCH_SIDE_BADGES}
        reserveLabels={QUICK_MATCH_RESERVE_LABELS}
      />,
    );
    const reserve = screen.getByRole('button', { name: /Lee/ });
    expect(within(reserve).getByText('You')).toBeInTheDocument();
  });

  it('keeps the existing Home/Away wording for boards that do not opt in', () => {
    render(
      <FormationBoard
        slots={slots}
        players={[me, striker]}
        canEdit={false}
        onAssign={vi.fn()}
        onRemove={vi.fn()}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Home position 2, empty' })).toBeInTheDocument();
    expect(screen.queryByTestId('formation-side-badge')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Home reserves' })).toBeInTheDocument();
  });
});
