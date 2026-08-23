import type { PublicUser } from '@footy-finder/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  FormationBoard,
  isFormationPositionValid,
  type FormationBoardPlayer,
} from './FormationBoard.js';

const user = (id: string): PublicUser => ({
  id,
  userId: id,
  username: id,
  displayName: `Player ${id}`,
  avatarUrl: null,
  bio: null,
  preferredPositions: [],
  dominantFoot: null,
  homeArea: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const players: FormationBoardPlayer[] = ['one', 'two', 'three'].map((id) => ({
  id,
  team: 'HOME',
  user: user(id),
}));

describe('FormationBoard', () => {
  it('uses horizontal halfway geometry and enforces Match halves without limiting Team pages', () => {
    const { container } = render(
      <FormationBoard
        slots={[]}
        players={[]}
        canEdit={false}
        onAssign={vi.fn()}
        onRemove={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByTestId('pitch-halfway-line')).toHaveClass('inset-x-0', 'top-1/2');
    expect(container.querySelector('.formation-pitch')).toBeInTheDocument();
    expect(isFormationPositionValid('two-sided', 'HOME', 49)).toBe(false);
    expect(isFormationPositionValid('two-sided', 'AWAY', 51)).toBe(false);
    expect(isFormationPositionValid('two-sided', 'HOME', 50)).toBe(true);
    expect(isFormationPositionValid('single-team', 'HOME', 12)).toBe(true);
  });

  it('requires an explicit bench/remove choice for an occupied non-starter drop', () => {
    const assign = vi.fn().mockResolvedValue(undefined);
    render(
      <FormationBoard
        slots={[
          {
            id: 'slot-1',
            team: 'HOME',
            slotIndex: 1,
            positionX: 50,
            positionY: 75,
            playerId: 'one',
            player: players[0],
          },
          {
            id: 'slot-2',
            team: 'HOME',
            slotIndex: 2,
            positionX: 30,
            positionY: 60,
            playerId: 'two',
            player: players[1],
          },
        ]}
        players={players}
        canEdit
        occupiedDropMode="explicit"
        onAssign={assign}
        onRemove={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Player three/i }));
    fireEvent.click(screen.getByRole('button', { name: /HOME slot 1/i }));
    expect(screen.getByRole('dialog', { name: 'Position already occupied' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move to substitutes' }));
    expect(assign).toHaveBeenCalledWith({
      slotId: 'slot-1',
      playerId: 'three',
      displacedPlayerAction: 'BENCH',
    });
  });
});
