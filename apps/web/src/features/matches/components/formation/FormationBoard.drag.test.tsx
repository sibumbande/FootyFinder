import type { PublicUser } from '@footy-finder/shared';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FormationBoard,
  formationSignature,
  type FormationBoardPlayer,
  type FormationBoardSlot,
} from './FormationBoard.js';
import {
  formationTimingSamples,
  resetFormationTimings,
  summarizeFormationTimings,
} from './formation-timing.js';

// jsdom has no layout or pointer capture. Give the pitch a fixed 200 x 400 box and make pointer
// events carry coordinates and a pointerId, like a real browser does.
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
beforeEach(resetFormationTimings);
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
const striker: FormationBoardPlayer = { id: 'striker', team: 'HOME', user: user('striker') };
const keeper: FormationBoardPlayer = { id: 'keeper', team: 'HOME', user: user('keeper') };

const baseSlots = (): FormationBoardSlot[] => [
  { id: 's1', team: 'HOME', slotIndex: 1, positionX: 50, positionY: 80, playerId: 'striker', player: striker },
  { id: 's2', team: 'HOME', slotIndex: 2, positionX: 30, positionY: 60, playerId: null },
  { id: 's3', team: 'HOME', slotIndex: 3, positionX: 80, positionY: 90, playerId: 'keeper', player: keeper },
];

const deferred = () => {
  let resolve!: (value?: unknown) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const board = (props: Partial<Parameters<typeof FormationBoard>[0]> = {}) => (
  <FormationBoard
    slots={baseSlots()}
    players={[striker, keeper]}
    canEdit
    onAssign={vi.fn().mockResolvedValue(undefined)}
    onRemove={vi.fn().mockResolvedValue(undefined)}
    onMove={vi.fn().mockResolvedValue(undefined)}
    {...props}
  />
);

const marker = (name: RegExp) => screen.getByRole('button', { name });
const position = (element: HTMLElement) => ({ left: element.style.left, top: element.style.top });
/** Drag a marker to pitch percentages (x%, y%) with a mouse-like pointer. */
const drag = (element: HTMLElement, x: number, y: number, finish: 'up' | 'cancel' = 'up') => {
  const from = { clientX: (50 / 100) * PITCH.width, clientY: (80 / 100) * PITCH.height };
  const to = { clientX: (x / 100) * PITCH.width, clientY: (y / 100) * PITCH.height };
  fireEvent.pointerDown(element, { ...from, pointerId: 7 });
  fireEvent.pointerMove(element, { ...to, pointerId: 7 });
  if (finish === 'up') fireEvent.pointerUp(element, { ...to, pointerId: 7 });
  else fireEvent.pointerCancel(element, { ...to, pointerId: 7 });
};

describe('FormationBoard drag stability (TKT-505)', () => {
  it('lands a dropped marker immediately and confirms it in the background', async () => {
    const write = deferred();
    const onMove = vi.fn(() => write.promise);
    render(board({ onMove }));

    drag(marker(/position 1, occupied by Player striker/), 50, 70);

    expect(position(marker(/position 1, occupied/))).toEqual({ left: '50%', top: '70%' });
    await waitFor(() => expect(onMove).toHaveBeenCalledWith('s1', { positionX: 50, positionY: 70 }));
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    await act(async () => write.resolve());
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(position(marker(/position 1, occupied/))).toEqual({ left: '50%', top: '70%' });
  });

  it('treats a cancelled pointer as an aborted drag, never as a drop', async () => {
    const onMove = vi.fn();
    const onAssign = vi.fn();
    render(board({ onMove, onAssign }));

    drag(marker(/position 1, occupied/), 50, 70, 'cancel');

    expect(position(marker(/position 1, occupied/))).toEqual({ left: '50%', top: '80%' });
    await act(async () => Promise.resolve());
    expect(onMove).not.toHaveBeenCalled();
    expect(onAssign).not.toHaveBeenCalled();
  });

  it('does not reset a pending optimistic move when the parent re-renders equal data', async () => {
    const write = deferred();
    const { rerender } = render(board({ onMove: vi.fn(() => write.promise) }));

    drag(marker(/position 1, occupied/), 50, 70);
    rerender(board({ onMove: vi.fn(() => write.promise) }));

    expect(position(marker(/position 1, occupied/))).toEqual({ left: '50%', top: '70%' });
    await act(async () => write.resolve());
  });

  it('restores the authoritative position when the server rejects the move', async () => {
    const write = deferred();
    render(board({ onMove: vi.fn(() => write.promise) }));

    drag(marker(/position 1, occupied/), 50, 70);
    await act(async () => write.reject(new Error('rejected')));

    expect(await screen.findByText('Save failed — rolled back')).toBeInTheDocument();
    expect(position(marker(/position 1, occupied/))).toEqual({ left: '50%', top: '80%' });
  });

  it('holds a server echo that arrives mid-drag and applies it once the drag ends', () => {
    const { rerender } = render(board({ onMove: vi.fn().mockResolvedValue(undefined) }));
    const striker = marker(/position 1, occupied/);
    fireEvent.pointerDown(striker, { clientX: 100, clientY: 320, pointerId: 3 });
    fireEvent.pointerMove(striker, { clientX: 100, clientY: 280, pointerId: 3 });

    const echoed = baseSlots().map((slot) =>
      slot.id === 's3' ? { ...slot, positionX: 70, positionY: 95 } : slot,
    );
    rerender(board({ slots: echoed, onMove: vi.fn().mockResolvedValue(undefined) }));

    expect(position(marker(/position 1, occupied/))).toEqual({ left: '50%', top: '70%' });
    expect(position(marker(/position 3, occupied/))).toEqual({ left: '80%', top: '90%' });

    fireEvent.pointerCancel(marker(/position 1, occupied/), { pointerId: 3 });
    expect(position(marker(/position 3, occupied/))).toEqual({ left: '70%', top: '95%' });
    expect(position(marker(/position 1, occupied/))).toEqual({ left: '50%', top: '80%' });
  });

  it('coalesces moves made in the same tick into one write of the final position', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(board({ onMove }));

    drag(marker(/position 1, occupied/), 60, 70);
    drag(marker(/position 1, occupied/), 70, 75);

    await waitFor(() => expect(onMove).toHaveBeenCalledTimes(1));
    expect(onMove).toHaveBeenCalledWith('s1', { positionX: 70, positionY: 75 });
  });

  it('serializes rapid consecutive moves and sends only the newest queued move for a slot', async () => {
    const first = deferred();
    const onMove = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    render(board({ onMove }));

    drag(marker(/position 1, occupied/), 60, 70);
    await waitFor(() => expect(onMove).toHaveBeenCalledTimes(1));
    // Two more moves while the first write is still in flight: they queue behind it, and the
    // superseded middle move is never sent.
    drag(marker(/position 1, occupied/), 65, 72);
    drag(marker(/position 1, occupied/), 70, 75);
    await act(async () => Promise.resolve());
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(position(marker(/position 1, occupied/))).toEqual({ left: '70%', top: '75%' });
    await act(async () => first.resolve());

    await waitFor(() => expect(onMove).toHaveBeenCalledTimes(2));
    expect(onMove.mock.calls).toEqual([
      ['s1', { positionX: 60, positionY: 70 }],
      ['s1', { positionX: 70, positionY: 75 }],
    ]);
  });

  it('records pointer-to-render and drop-to-confirm timings against the budget', async () => {
    render(board());

    drag(marker(/position 1, occupied/), 50, 70);
    await screen.findByText('Saved');

    expect(formationTimingSamples('pointer-to-render').length).toBeGreaterThan(0);
    expect(formationTimingSamples('drop-to-confirm')).toEqual([
      expect.objectContaining({ kind: 'drop-to-confirm', outcome: 'success' }),
    ]);
    expect(summarizeFormationTimings('pointer-to-render').withinBudget).toBe(true);
  });

  it('identifies formations by content rather than array identity', () => {
    expect(formationSignature(baseSlots())).toBe(formationSignature(baseSlots()));
    expect(formationSignature(baseSlots())).not.toBe(
      formationSignature([{ ...baseSlots()[0], positionY: 81 }, ...baseSlots().slice(1)]),
    );
  });
});

describe('FormationBoard touch drag (CEO batch 1, item 4)', () => {
  it('drags with a finger, gives haptic feedback on pick-up and drop, and saves the position', async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(board({ onMove }));
    const striker = marker(/position 1, occupied by Player striker/);
    const touch = { pointerId: 9, pointerType: 'touch' };
    fireEvent.pointerDown(striker, { ...touch, clientX: 100, clientY: 320 });
    fireEvent.pointerMove(striker, { ...touch, clientX: 102, clientY: 318 }); // under 5px: still a tap
    expect(vibrate).not.toHaveBeenCalled();
    fireEvent.pointerMove(striker, { ...touch, clientX: 140, clientY: 200 });
    expect(striker).toHaveClass('formation-marker--dragging');
    expect(document.querySelector('.formation-pitch')).toHaveClass('formation-pitch--dragging');
    expect(vibrate).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(striker, { ...touch, clientX: 140, clientY: 200 });
    expect(vibrate).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(onMove).toHaveBeenCalledWith('s1', { positionX: 70, positionY: 50 }));
  });

  it('leaves page scrolling alone over markers a viewer cannot move', () => {
    render(board({ canEdit: false }));
    expect(marker(/position 1, occupied/)).toHaveClass('formation-marker--static');
    expect(document.querySelector('.formation-pitch')).not.toHaveClass('formation-pitch--dragging');
  });
});
