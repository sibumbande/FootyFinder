import type { PublicUser } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FormationBoard,
  type FormationBoardPlayer,
  type FormationBoardSlot,
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

const me: FormationBoardPlayer = { id: 'me', team: 'HOME', user: user('me') };
const rival: FormationBoardPlayer = { id: 'rival', team: 'HOME', user: user('rival') };
const opponent: FormationBoardPlayer = { id: 'opponent', team: 'AWAY', user: user('opponent') };

const slots: FormationBoardSlot[] = [
  { id: 'home-1', team: 'HOME', slotIndex: 1, positionX: 50, positionY: 80, playerId: null },
  { id: 'home-2', team: 'HOME', slotIndex: 2, positionX: 30, positionY: 70, playerId: null },
  { id: 'away-1', team: 'AWAY', slotIndex: 1, positionX: 50, positionY: 20, playerId: null },
];

const renderBoard = (props: Partial<Parameters<typeof FormationBoard>[0]> = {}) =>
  render(
    <FormationBoard
      slots={slots}
      players={[me, rival, opponent]}
      canEdit={false}
      onAssign={vi.fn()}
      onRemove={vi.fn()}
      onMove={vi.fn()}
      claimableSlotIds={['home-1', 'home-2']}
      currentPlayerId="me"
      {...props}
    />,
  );

const homeReserves = () =>
  screen.getByRole('heading', { name: /Home reserves/i }).closest('div')!.parentElement!;

afterEach(cleanup);

describe('FormationBoard position claims', () => {
  it('lets a joined player claim an open position on their own side and leaves reserves', async () => {
    const onClaim = vi.fn().mockResolvedValue(undefined);
    renderBoard({ onClaim });

    expect(screen.getAllByText('CLAIM')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /position 1, open, claim it/i }));

    await waitFor(() => expect(onClaim).toHaveBeenCalledWith('home-1'));
    expect(await screen.findByRole('button', { name: /position 1, occupied by Player me/i })).toBeInTheDocument();
    expect(within(homeReserves()).queryByText('Player me')).not.toBeInTheDocument();
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('rolls the optimistic claim back when the server reports a conflict', async () => {
    const onClaim = vi.fn().mockRejectedValue(new Error('POSITION_ALREADY_CLAIMED'));
    renderBoard({ onClaim });

    fireEvent.click(screen.getByRole('button', { name: /position 1, open, claim it/i }));

    expect(await screen.findByText('Save failed — rolled back')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /position 1, open, claim it/i }),
    ).toBeInTheDocument();
    expect(within(homeReserves()).getByText('Player me')).toBeInTheDocument();
  });

  it('never offers the other side or an unlisted slot for claiming', () => {
    const onClaim = vi.fn();
    renderBoard({ onClaim });

    const awaySlot = screen.getByRole('button', { name: /Away position 1/i });
    expect(awaySlot).toHaveAccessibleName(/empty/);
    fireEvent.click(awaySlot);
    expect(onClaim).not.toHaveBeenCalled();
  });

  it('shows no claim affordance when the lobby is immutable', () => {
    const onClaim = vi.fn();
    renderBoard({ onClaim, claimableSlotIds: [], readonlyHint: 'Locked' });

    expect(screen.queryByText('CLAIM')).not.toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Home position 1/i }));
    expect(onClaim).not.toHaveBeenCalled();
  });

  it('moves an already-placed player optimistically (SELF_MOVE) without holding two slots', async () => {
    let resolveClaim: () => void = () => undefined;
    const onClaim = vi.fn(() => new Promise<void>((resolve) => (resolveClaim = resolve)));
    renderBoard({
      onClaim,
      slots: [{ ...slots[0], playerId: 'me', player: me }, slots[1], slots[2]],
      claimableSlotIds: ['home-2'],
    });

    fireEvent.click(screen.getByRole('button', { name: /position 2, open, claim it/i }));

    expect(screen.getByRole('button', { name: /position 2, occupied by Player me/i })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getAllByRole('button', { name: /Player me/i })).toHaveLength(1);
    await waitFor(() => expect(onClaim).toHaveBeenCalledWith('home-2'));
    resolveClaim();
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
  });

  it('ignores claim props for the organiser, who edits the board directly', () => {
    const onClaim = vi.fn();
    renderBoard({ onClaim, canEdit: true });

    expect(screen.queryByText('CLAIM')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Home position 1/i }));
    expect(onClaim).not.toHaveBeenCalled();
  });
});
