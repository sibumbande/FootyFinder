import type { DisplacedPlayerAction, PublicUser, TeamSide } from '@footy-finder/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar.js';
import { Button } from '@/components/ui/Button.js';
import { formationNow, recordFormationTiming } from './formation-timing.js';

export interface FormationBoardPlayer {
  id: string;
  team: TeamSide;
  user: PublicUser;
  badge?: string;
}

export interface FormationBoardSlot {
  id: string;
  team: TeamSide;
  slotIndex: number;
  positionX: number;
  positionY: number;
  playerId?: string | null;
  player?: FormationBoardPlayer | null;
  isOpen?: boolean;
}

type Assignment = {
  slotId: string;
  playerId: string;
  displacedPlayerAction?: DisplacedPlayerAction;
};

type PlayerDrag = {
  playerId: string;
  sourceSlotId: string;
  team: TeamSide;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  positionX: number;
  positionY: number;
  active: boolean;
};

type PendingAssignment = { target: FormationBoardSlot; playerId: string };
const clamp = (value: number) => Math.max(4, Math.min(96, value));
/** Content identity of a formation, so equal data in a new array never resets the board. */
export const formationSignature = (items: readonly FormationBoardSlot[]) =>
  items
    .map(
      (slot) =>
        `${slot.id}:${slot.playerId ?? ''}:${Number(slot.positionX)}:${Number(slot.positionY)}:${slot.isOpen ? 1 : 0}:${slot.player?.user.displayName ?? ''}:${slot.player?.user.avatarUrl ?? ''}`,
    )
    .join('|');
/** Compact on-pitch name: first word, capped so markers stay readable on a phone. */
export const shortName = (displayName: string) => {
  const first = displayName.trim().split(/\s+/)[0] ?? displayName;
  return first.length > 12 ? `${first.slice(0, 11)}…` : first;
};
export const isFormationPositionValid = (
  pitchMode: 'two-sided' | 'single-team',
  team: TeamSide,
  positionY: number,
) => pitchMode === 'single-team' || (team === 'HOME' ? positionY >= 50 : positionY <= 50);

export function FormationBoard({
  slots,
  players,
  canEdit,
  onAssign,
  onRemove,
  onMove,
  sides = ['HOME', 'AWAY'],
  pitchMode = 'two-sided',
  occupiedDropMode = 'implicit',
  heading = 'Formation',
  editableHint = 'Tap or drag players; drag empty slot space to reposition.',
  readonlyHint = 'The organiser controls the pre-match formation.',
  reserveLabels,
  claimableSlotIds = [],
  onClaim,
  currentPlayerId,
  sideLabels,
  sideBadges,
  emptySlotsAreOpen = false,
}: {
  slots: FormationBoardSlot[];
  players: FormationBoardPlayer[];
  canEdit: boolean;
  onAssign: (input: Assignment) => Promise<unknown>;
  onRemove: (slotId: string) => Promise<unknown>;
  onMove: (slotId: string, position: { positionX: number; positionY: number }) => Promise<unknown>;
  sides?: TeamSide[];
  pitchMode?: 'two-sided' | 'single-team';
  occupiedDropMode?: 'implicit' | 'explicit';
  heading?: string;
  editableHint?: string;
  readonlyHint?: string;
  reserveLabels?: Partial<Record<TeamSide, string>>;
  /** Open slots the viewer may claim for themselves (DEC-013). Ignored while `canEdit`. */
  claimableSlotIds?: readonly string[];
  onClaim?: (slotId: string) => Promise<unknown>;
  /** The viewer's own player id, used for the optimistic claim and current-user emphasis. */
  currentPlayerId?: string | null;
  /** Text name for each side, used in accessible labels (defaults to Home/Away). */
  sideLabels?: Partial<Record<TeamSide, string>>;
  /** Short letter drawn on every marker so sides are distinguishable without colour. */
  sideBadges?: Partial<Record<TeamSide, string>>;
  /** Treat every empty slot as an explicit "open" position (Quick Matches). */
  emptySlotsAreOpen?: boolean;
}) {
  // TKT-505 state model:
  // - `slots` (props) is the authoritative server formation.
  // - `localSlots` is what is drawn: the server formation plus any optimistic change.
  // - Server props are adopted only when their content actually changes (not on every render),
  //   and never while a drag is active or a write is still settling. A buffered update is
  //   applied as soon as the board is idle again.
  // - Transient drag coordinates live in `playerDrag`, separate from both.
  const [localSlots, setLocalSlots] = useState(slots);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [playerDrag, setPlayerDrag] = useState<PlayerDrag | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [landingSlotId, setLandingSlotId] = useState<string | null>(null);
  const [pendingAssignment, setPendingAssignment] = useState<PendingAssignment | null>(null);
  const [claimingSlotId, setClaimingSlotId] = useState<string | null>(null);
  const claimable = new Set(canEdit || !onClaim ? [] : claimableSlotIds);
  const sideLabel = (team: TeamSide) => sideLabels?.[team] ?? (team === 'HOME' ? 'Home' : 'Away');
  const isOpenSlot = (slot: FormationBoardSlot) => Boolean(slot.isOpen || emptySlotsAreOpen);
  const describeSlot = (slot: FormationBoardSlot) => {
    const base = `${sideLabel(slot.team)} position ${slot.slotIndex}`;
    if (slot.player)
      return `${base}, occupied by ${slot.player.user.displayName}${slot.playerId === currentPlayerId ? ' (you)' : ''}`;
    if (claimable.has(slot.id)) return `${base}, open, claim it`;
    return `${base}, ${isOpenSlot(slot) ? 'open' : 'empty'}`;
  };
  const pitch = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);

  const serverSlots = useRef(slots);
  const appliedSignature = useRef(formationSignature(slots));
  const writesInFlight = useRef(0);
  const dragActive = useRef(false);
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const latestMove = useRef(new Map<string, number>());
  const moveSequence = useRef(0);
  const feedbackStartedAt = useRef<number | null>(null);
  const incomingSignature = formationSignature(slots);

  const adoptServerSlots = (force = false) => {
    if (!force && (writesInFlight.current > 0 || dragActive.current)) return;
    const signature = formationSignature(serverSlots.current);
    if (!force && signature === appliedSignature.current) return;
    appliedSignature.current = signature;
    setLocalSlots(serverSlots.current);
  };
  useEffect(() => {
    serverSlots.current = slots;
    adoptServerSlots();
    // Content-keyed on purpose: a parent re-render with an equal formation must not reset the
    // board, so the dependency is the signature rather than the array identity.
  }, [incomingSignature]);

  useLayoutEffect(() => {
    if (feedbackStartedAt.current === null) return;
    recordFormationTiming('pointer-to-render', formationNow() - feedbackStartedAt.current);
    feedbackStartedAt.current = null;
  }, [localSlots, playerDrag]);
  const markFeedbackStart = (eventTimeStamp?: number) => {
    const now = formationNow();
    feedbackStartedAt.current =
      eventTimeStamp && eventTimeStamp > 0 && eventTimeStamp <= now ? eventTimeStamp : now;
  };

  const onField = new Set(localSlots.flatMap((slot) => (slot.playerId ? [slot.playerId] : [])));
  const reserves = players.filter((item) => !onField.has(item.id));
  const markSaved = () => {
    setSaving('saved');
    window.setTimeout(() => setSaving('idle'), 1200);
  };

  /**
   * Apply an optimistic change immediately, then run the server write strictly after any earlier
   * write has settled. On rejection the board is restored to the authoritative server formation.
   */
  const commit = (
    optimistic: (items: FormationBoardSlot[]) => FormationBoardSlot[],
    write: () => Promise<unknown>,
  ) => {
    const startedAt = formationNow();
    if (feedbackStartedAt.current === null) feedbackStartedAt.current = startedAt;
    writesInFlight.current += 1;
    setSaving('saving');
    setLocalSlots(optimistic);
    const run = writeQueue.current.then(write);
    writeQueue.current = run.catch(() => undefined);
    return run.then(
      (value) => {
        recordFormationTiming('drop-to-confirm', formationNow() - startedAt, 'success');
        writesInFlight.current -= 1;
        markSaved();
        adoptServerSlots();
        return value;
      },
      (error: unknown) => {
        recordFormationTiming('drop-to-confirm', formationNow() - startedAt, 'error');
        writesInFlight.current -= 1;
        setSaving('error');
        adoptServerSlots(true);
        throw error;
      },
    );
  };

  const assign = (
    target: FormationBoardSlot,
    playerId: string,
    displacedPlayerAction?: DisplacedPlayerAction,
  ) => {
    const source = localSlots.find((slot) => slot.playerId === playerId);
    const displaced = target.player;
    return commit(
      (items) =>
        items.map((slot) => {
          if (slot.id === target.id)
            return {
              ...slot,
              playerId,
              player: players.find((player) => player.id === playerId) ?? null,
              isOpen: false,
            };
          if (source && slot.id === source.id)
            return displaced &&
              (displacedPlayerAction === 'SWAP' || occupiedDropMode === 'implicit')
              ? { ...slot, playerId: displaced.id, player: displaced }
              : { ...slot, playerId: null, player: null };
          return slot;
        }),
      () => onAssign({ slotId: target.id, playerId, displacedPlayerAction }),
    );
  };

  const chooseAssignment = (target: FormationBoardSlot, playerId: string) => {
    const source = localSlots.find((slot) => slot.playerId === playerId);
    if (target.playerId && target.playerId !== playerId && occupiedDropMode === 'explicit') {
      if (source) void assign(target, playerId, 'SWAP').catch(() => undefined);
      else setPendingAssignment({ target, playerId });
    } else void assign(target, playerId).catch(() => undefined);
    setSelected(null);
  };

  const claim = async (target: FormationBoardSlot, eventTimeStamp?: number) => {
    if (!onClaim || !currentPlayerId || claimingSlotId) return;
    const me = players.find((player) => player.id === currentPlayerId) ?? null;
    markFeedbackStart(eventTimeStamp);
    setClaimingSlotId(target.id);
    try {
      // Optimistic: occupy the target and vacate any slot the player already holds (SELF_MOVE).
      // A conflict restores the server formation, which the conflict response has already
      // refreshed with the authoritative board.
      await commit(
        (items) =>
          items.map((slot) => {
            if (slot.id === target.id) return { ...slot, playerId: currentPlayerId, player: me };
            if (slot.playerId === currentPlayerId) return { ...slot, playerId: null, player: null };
            return slot;
          }),
        () => onClaim(target.id),
      );
    } catch {
      // Already rolled back and reported by commit().
    } finally {
      setClaimingSlotId(null);
    }
  };

  const removeSelected = async () => {
    const slot = localSlots.find((item) => item.playerId === selected);
    setSelected(null);
    if (!slot) return;
    await commit(
      (items) =>
        items.map((item) => (item.id === slot.id ? { ...item, playerId: null, player: null } : item)),
      () => onRemove(slot.id),
    ).catch(() => undefined);
  };

  const pointerPosition = (clientX: number, clientY: number) => {
    const rect = pitch.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      positionX: clamp(((clientX - rect.left) / rect.width) * 100),
      positionY: clamp(((clientY - rect.top) / rect.height) * 100),
      rect,
    };
  };
  /**
   * Move a marker to a new coordinate. The marker lands where it was dropped immediately. If
   * several moves of the same slot queue up behind a slow write, only the newest one is sent.
   */
  const savePosition = (slotId: string, position: { positionX: number; positionY: number }) => {
    const sequence = (moveSequence.current += 1);
    latestMove.current.set(slotId, sequence);
    return commit(
      (items) => items.map((slot) => (slot.id === slotId ? { ...slot, ...position } : slot)),
      () =>
        latestMove.current.get(slotId) === sequence
          ? onMove(slotId, position)
          : Promise.resolve(undefined),
    ).catch(() => undefined);
  };
  const nearestDropTarget = (
    clientX: number,
    clientY: number,
    sourceSlotId: string,
    team: TeamSide,
  ) => {
    const rect = pitch.current?.getBoundingClientRect();
    if (!rect) return null;
    const maximumDistance = Math.max(44, Math.min(rect.width, rect.height) * 0.11);
    return (
      localSlots
        .filter((slot) => slot.id !== sourceSlotId && slot.team === team)
        .map((slot) => ({
          slot,
          distance: Math.hypot(
            clientX - (rect.left + (Number(slot.positionX) / 100) * rect.width),
            clientY - (rect.top + (Number(slot.positionY) / 100) * rect.height),
          ),
        }))
        .filter(({ distance }) => distance <= maximumDistance)
        .sort((a, b) => a.distance - b.distance)[0]?.slot ?? null
    );
  };
  const endDrag = () => {
    setPlayerDrag(null);
    setDropTargetId(null);
    dragActive.current = false;
    adoptServerSlots();
  };
  const startPlayerDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    slot: FormationBoardSlot,
  ) => {
    if (!canEdit || !slot.playerId || selected) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragActive.current = true;
    setPlayerDrag({
      playerId: slot.playerId,
      sourceSlotId: slot.id,
      team: slot.team,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      positionX: Number(slot.positionX),
      positionY: Number(slot.positionY),
      active: false,
    });
  };
  const movePlayerDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!playerDrag || event.pointerId !== playerDrag.pointerId) return;
    const position = pointerPosition(event.clientX, event.clientY);
    if (!position) return;
    const active =
      playerDrag.active ||
      Math.hypot(event.clientX - playerDrag.startClientX, event.clientY - playerDrag.startClientY) >
        5;
    if (active && !playerDrag.active) setSelected(null);
    if (active) markFeedbackStart(event.timeStamp);
    setPlayerDrag((current) =>
      current
        ? { ...current, positionX: position.positionX, positionY: position.positionY, active }
        : null,
    );
    setDropTargetId(
      active
        ? (nearestDropTarget(event.clientX, event.clientY, playerDrag.sourceSlotId, playerDrag.team)
            ?.id ?? null)
        : null,
    );
  };
  const finishPlayerDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!playerDrag || event.pointerId !== playerDrag.pointerId) return;
    const position = pointerPosition(event.clientX, event.clientY);
    const target = playerDrag.active
      ? nearestDropTarget(event.clientX, event.clientY, playerDrag.sourceSlotId, playerDrag.team)
      : null;
    if (playerDrag.active) {
      suppressClick.current = true;
      const valid =
        position && isFormationPositionValid(pitchMode, playerDrag.team, position.positionY);
      setLandingSlotId(valid ? (target?.id ?? playerDrag.sourceSlotId) : playerDrag.sourceSlotId);
      // Leave drag mode first so the optimistic drop below is not buffered behind the drag.
      dragActive.current = false;
      markFeedbackStart(event.timeStamp);
      if (valid && target) chooseAssignment(target, playerDrag.playerId);
      else if (valid && position)
        void savePosition(playerDrag.sourceSlotId, {
          positionX: position.positionX,
          positionY: position.positionY,
        });
      window.setTimeout(() => setLandingSlotId(null), 460);
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    } else {
      suppressClick.current = true;
      setSelected(playerDrag.playerId);
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
    endDrag();
  };
  /**
   * A cancelled pointer (for example the browser taking over a touch to scroll) aborts the drag
   * and returns the marker to its position. It must never be treated as a drop.
   */
  const cancelPlayerDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!playerDrag || event.pointerId !== playerDrag.pointerId) return;
    if (playerDrag.active) {
      setLandingSlotId(playerDrag.sourceSlotId);
      window.setTimeout(() => setLandingSlotId(null), 460);
    }
    endDrag();
  };
  const moveEmptySlot = (clientX: number, clientY: number, slot: FormationBoardSlot) => {
    const position = pointerPosition(clientX, clientY);
    if (!position || !isFormationPositionValid(pitchMode, slot.team, position.positionY)) {
      setLandingSlotId(slot.id);
      window.setTimeout(() => setLandingSlotId(null), 460);
      return;
    }
    markFeedbackStart();
    void savePosition(slot.id, {
      positionX: position.positionX,
      positionY: position.positionY,
    });
  };
  const startEmptySlotDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    slot: FormationBoardSlot,
  ) => {
    if (!canEdit || selected || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const element = event.currentTarget;
    element.onpointerup = (up) => {
      element.onpointerup = null;
      element.onpointercancel = null;
      moveEmptySlot(up.clientX, up.clientY, slot);
    };
    element.onpointercancel = () => {
      element.onpointerup = null;
      element.onpointercancel = null;
    };
  };

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-content-strong">{heading}</h2>
          <p className="text-sm text-content-muted">{canEdit ? editableHint : readonlyHint}</p>
        </div>
        <span
          className={`text-xs font-bold ${saving === 'error' ? 'text-danger-700' : 'text-content-muted'}`}
        >
          {saving === 'saving'
            ? 'Saving…'
            : saving === 'saved'
              ? 'Saved'
              : saving === 'error'
                ? 'Save failed — rolled back'
                : ''}
        </span>
      </div>
      <div
        ref={pitch}
        className={`formation-pitch relative mx-auto aspect-[68/105] w-full max-w-xl overflow-hidden rounded-3xl border-4 border-pitch-border bg-pitch shadow-soft ${playerDrag?.active ? 'formation-pitch--dragging' : ''}`}
      >
        <div
          data-testid="pitch-halfway-line"
          className="absolute inset-x-0 top-1/2 h-px bg-pitch-line/80"
        />
        <div className="absolute left-1/2 top-1/2 size-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-pitch-line/80" />
        <div className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pitch-line" />
        <div className="absolute left-1/2 top-0 h-20 w-1/2 -translate-x-1/2 border-2 border-t-0 border-pitch-line/80" />
        <div className="absolute bottom-0 left-1/2 h-20 w-1/2 -translate-x-1/2 border-2 border-b-0 border-pitch-line/80" />
        {localSlots.map((slot) => {
          const dragging = playerDrag?.sourceSlotId === slot.id;
          const isCurrentPlayer = Boolean(currentPlayerId && slot.playerId === currentPlayerId);
          const badge = sideBadges?.[slot.team];
          return (
            <button
              key={slot.id}
              type="button"
              data-formation-slot-id={slot.id}
              onPointerDown={(event) =>
                slot.playerId ? startPlayerDrag(event, slot) : startEmptySlotDrag(event, slot)
              }
              onPointerMove={movePlayerDrag}
              onPointerUp={(event) => slot.playerId && finishPlayerDrag(event)}
              onPointerCancel={cancelPlayerDrag}
              onClick={() => {
                if (!canEdit && claimable.has(slot.id) && !slot.playerId) {
                  void claim(slot);
                  return;
                }
                if (suppressClick.current || !canEdit) return;
                if (selected) chooseAssignment(slot, selected);
                else if (slot.playerId) setSelected(slot.playerId);
              }}
              className={`formation-marker absolute grid size-12 place-items-center rounded-full border-2 shadow-sm ${dragging ? 'formation-marker--dragging' : ''} ${dropTargetId === slot.id ? 'formation-marker--drop-target' : ''} ${landingSlotId === slot.id ? 'formation-marker--landing' : ''} ${slot.isOpen ? 'ring-4 ring-warning-300' : ''} ${claimable.has(slot.id) && !slot.playerId ? 'formation-marker--claimable ring-4 ring-brand-200' : ''} ${isCurrentPlayer ? 'formation-marker--current ring-4 ring-brand-500' : ''} ${claimingSlotId === slot.id ? 'animate-pulse' : ''} ${selected && slot.playerId !== selected ? 'formation-marker--selectable border-brand-200 bg-brand-50' : slot.team === 'HOME' ? 'border-team-home-border bg-team-home-muted text-team-home' : 'border-team-away-border bg-team-away-muted text-team-away'}`}
              style={{
                left: `${dragging ? playerDrag.positionX : slot.positionX}%`,
                top: `${dragging ? playerDrag.positionY : slot.positionY}%`,
                zIndex: dragging ? 30 : dropTargetId === slot.id ? 20 : 10,
              }}
              aria-busy={claimingSlotId === slot.id || undefined}
              aria-label={describeSlot(slot)}
            >
              {badge && (
                <span
                  aria-hidden="true"
                  data-testid="formation-side-badge"
                  className={`pointer-events-none absolute -left-1.5 -top-1.5 grid size-5 place-items-center rounded-full border-2 border-surface text-[10px] font-black text-content-inverse ${slot.team === 'HOME' ? 'bg-team-home' : 'bg-team-away'}`}
                >
                  {badge}
                </span>
              )}
              {slot.player ? (
                <span className="formation-marker__avatar pointer-events-none">
                  <Avatar user={slot.player.user} size="sm" />
                </span>
              ) : (
                <span className="pointer-events-none text-[10px] font-black">
                  {claimable.has(slot.id) ? 'CLAIM' : isOpenSlot(slot) ? 'OPEN' : slot.slotIndex}
                </span>
              )}
              {slot.player && (
                <span
                  aria-hidden="true"
                  className={`formation-marker__name pointer-events-none absolute left-1/2 top-full mt-1 max-w-[5.5rem] -translate-x-1/2 truncate whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-none shadow-sm ${isCurrentPlayer ? 'bg-brand-600 text-content-inverse' : 'bg-surface/90 text-content-strong'}`}
                >
                  {isCurrentPlayer ? 'You' : shortName(slot.player.user.displayName)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {selected && canEdit && (
        <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm font-semibold text-brand-700">
          <span>
            {players.find((item) => item.id === selected)?.user.displayName ?? 'Player'} selected
          </span>
          <div className="flex gap-2">
            {onField.has(selected) && (
              <Button variant="secondary" onClick={() => void removeSelected()}>
                Move off pitch
              </Button>
            )}
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {sides.map((team) => (
          <ReserveBench
            key={team}
            team={team}
            players={reserves.filter((item) => item.team === team)}
            selected={selected}
            canEdit={canEdit}
            onSelect={setSelected}
            label={reserveLabels?.[team]}
            badge={sideBadges?.[team]}
            currentPlayerId={currentPlayerId}
          />
        ))}
      </div>
      {pendingAssignment && (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-content-strong/50 p-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="occupied-slot-title"
            className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-soft"
          >
            <h3 id="occupied-slot-title" className="text-lg font-bold text-content-strong">
              Position already occupied
            </h3>
            <p className="mt-2 text-sm text-content-muted">
              Choose what happens to the current starter.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  void assign(pendingAssignment.target, pendingAssignment.playerId, 'BENCH').catch(
                    () => undefined,
                  );
                  setPendingAssignment(null);
                }}
              >
                Move to substitutes
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  void assign(pendingAssignment.target, pendingAssignment.playerId, 'REMOVE').catch(
                    () => undefined,
                  );
                  setPendingAssignment(null);
                }}
              >
                Remove from lineup
              </Button>
              <Button variant="ghost" onClick={() => setPendingAssignment(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ReserveBench({
  team,
  players,
  selected,
  canEdit,
  onSelect,
  label,
  badge,
  currentPlayerId,
}: {
  team: TeamSide;
  players: FormationBoardPlayer[];
  selected: string | null;
  canEdit: boolean;
  onSelect: (id: string) => void;
  label?: string;
  badge?: string;
  currentPlayerId?: string | null;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${team === 'HOME' ? 'border-team-home-border bg-team-home-muted' : 'border-team-away-border bg-team-away-muted'}`}
    >
      <div className="mb-3 flex justify-between">
        <h3
          className={`flex items-center gap-2 font-bold ${team === 'HOME' ? 'text-team-home' : 'text-team-away'}`}
        >
          {badge && (
            <span
              aria-hidden="true"
              className={`grid size-5 place-items-center rounded-full text-[10px] font-black text-content-inverse ${team === 'HOME' ? 'bg-team-home' : 'bg-team-away'}`}
            >
              {badge}
            </span>
          )}
          {label ?? (team === 'HOME' ? 'Home reserves' : 'Away reserves')}
        </h3>
        <span className="text-xs font-bold text-content-muted">{players.length}</span>
      </div>
      <div className="grid gap-2">
        {players.length === 0 && <p className="text-sm text-content-muted">No reserve players.</p>}
        {players.map((player) => (
          <button
            key={player.id}
            type="button"
            disabled={!canEdit}
            onClick={() => onSelect(player.id)}
            className={`flex items-center gap-2 rounded-xl border p-2 text-left ${selected === player.id ? 'border-brand-500 bg-surface' : 'border-line bg-surface/70'} disabled:cursor-default`}
          >
            <Avatar user={player.user} size="sm" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-content-strong">
              {player.user.displayName}
            </span>
            {player.id === currentPlayerId && (
              <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-black uppercase text-content-inverse">
                You
              </span>
            )}
            {player.badge && (
              <span className="text-[10px] font-bold uppercase text-content-muted">
                {player.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
