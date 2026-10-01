import type { PublicUser } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FormationBoardPlayer, FormationBoardSlot } from './FormationBoard.js';
import { QuickMatchPitches } from './QuickMatchPitches.js';

// jsdom has no layout or pointer capture: a fixed 200 x 400 pitch and pointer events with ids.
const PITCH = { left: 0, top: 0, width: 200, height: 400 };
const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalPointerEvent = window.PointerEvent;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ ...PITCH, right: PITCH.width, bottom: PITCH.height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  HTMLElement.prototype.setPointerCapture = vi.fn();
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  window.PointerEvent = originalPointerEvent;
});
afterEach(cleanup);

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
const homeKeeper: FormationBoardPlayer = { id: 'hk', team: 'HOME', user: user('hk') };
const awayKeeper: FormationBoardPlayer = { id: 'ak', team: 'AWAY', user: user('ak') };
// The stored 5-a-side default: Home keeper at y 91, Away keeper mirrored at y 9.
const slots: FormationBoardSlot[] = [
  { id: 'h1', team: 'HOME', slotIndex: 1, positionX: 50, positionY: 91, playerId: 'hk', player: homeKeeper },
  { id: 'h5', team: 'HOME', slotIndex: 5, positionX: 50, positionY: 20, playerId: null },
  { id: 'a1', team: 'AWAY', slotIndex: 1, positionX: 50, positionY: 9, playerId: 'ak', player: awayKeeper },
  { id: 'a5', team: 'AWAY', slotIndex: 5, positionX: 50, positionY: 80, playerId: null },
];

const pitches = (props: Partial<Parameters<typeof QuickMatchPitches>[0]> = {}) =>
  render(
    <QuickMatchPitches
      slots={slots}
      players={[homeKeeper, awayKeeper]}
      canEdit={false}
      claimableSlotIds={[]}
      onClaim={vi.fn().mockResolvedValue(undefined)}
      currentPlayerId={null}
      currentSide={null}
      readonlyHint="The organiser controls the pre-match formation."
      onAssign={vi.fn().mockResolvedValue(undefined)}
      onRemove={vi.fn().mockResolvedValue(undefined)}
      onMove={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />,
  );
const pitch = (team: 'home' | 'away') => within(screen.getByTestId(`pitch-${team}`));

describe('QuickMatchPitches (CEO batch 1, item 3)', () => {
  it('draws Home and Away on separate pitches, each showing only its own side, with A/B badges', () => {
    pitches();
    expect(pitch('home').getByRole('heading', { name: 'Team A · Home' })).toBeInTheDocument();
    expect(pitch('away').getByRole('heading', { name: 'Team B · Away' })).toBeInTheDocument();
    expect(pitch('home').queryByRole('button', { name: /Team B position/ })).not.toBeInTheDocument();
    expect(pitch('away').queryByRole('button', { name: /Team A position/ })).not.toBeInTheDocument();
    expect(pitch('home').getAllByTestId('formation-side-badge').map((badge) => badge.textContent)).toEqual(['A', 'A']);
    expect(pitch('away').getAllByTestId('formation-side-badge').map((badge) => badge.textContent)).toEqual(['B', 'B']);
  });

  it('turns the Away pitch around so both keepers defend the bottom goal, and keeps the default layout', () => {
    pitches();
    expect(pitch('home').getByRole('button', { name: /Team A position 1/ }).style.top).toBe('91%');
    expect(pitch('away').getByRole('button', { name: /Team B position 1/ }).style.top).toBe('91%');
    expect(pitch('away').getByRole('button', { name: /Team B position 5/ }).style.top).toBe('20%');
  });

  it('lets the Host move an Away marker anywhere on its pitch and saves it in stored coordinates', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    pitches({ canEdit: true, onMove });
    const keeper = pitch('away').getByRole('button', { name: /Team B position 1, occupied/ });
    fireEvent.pointerDown(keeper, { clientX: 100, clientY: 364, pointerId: 3 });
    fireEvent.pointerMove(keeper, { clientX: 60, clientY: 120, pointerId: 3 });
    fireEvent.pointerUp(keeper, { clientX: 60, clientY: 120, pointerId: 3 });
    // Dropped at 30% / 30% of the Away pitch: stored as y = 100 - 30 = 70 (its own half no longer matters).
    await waitFor(() => expect(onMove).toHaveBeenCalledWith('a1', { positionX: 30, positionY: 70 }));
  });

  it('never lets a player move markers; they only claim open positions on their side', async () => {
    const onMove = vi.fn();
    const onClaim = vi.fn().mockResolvedValue(undefined);
    pitches({ onMove, onClaim, claimableSlotIds: ['a5'], currentPlayerId: 'ak', currentSide: 'AWAY' });
    const keeper = pitch('away').getByRole('button', { name: /Team B position 1, occupied/ });
    fireEvent.pointerDown(keeper, { clientX: 100, clientY: 364, pointerId: 4 });
    fireEvent.pointerMove(keeper, { clientX: 60, clientY: 120, pointerId: 4 });
    fireEvent.pointerUp(keeper, { clientX: 60, clientY: 120, pointerId: 4 });
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByText(/organiser controls/, { selector: '[data-testid="pitch-away"] p' })).toBeInTheDocument();
    fireEvent.click(pitch('away').getByRole('button', { name: /Team B position 5, open, claim it/ }));
    await waitFor(() => expect(onClaim).toHaveBeenCalledWith('a5'));
  });

  it('opens the phone tabs on the viewer\'s own side', () => {
    pitches({ currentSide: 'AWAY' });
    expect(screen.getByRole('tab', { name: /Away/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('pitch-home')).toHaveClass('hidden');
    expect(screen.getByTestId('pitch-away')).toHaveClass('block');
    fireEvent.click(screen.getByRole('tab', { name: /Home/ }));
    expect(screen.getByTestId('pitch-home')).toHaveClass('block');
    expect(screen.getByTestId('pitch-away')).toHaveClass('hidden');
  });
});
