import type { FormationSlot, MatchParticipant, TeamSide } from '@footy-finder/shared';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar.js';
import { Button } from '@/components/ui/Button.js';

type Update = (
  slotId: string,
  input: { participantId?: string | null; positionX?: number; positionY?: number },
) => Promise<unknown>;

type PlayerDrag = {
  participantId: string;
  sourceSlotId: string;
  team: TeamSide;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  positionX: number;
  positionY: number;
  active: boolean;
};

const clampPercentage = (value: number) => Math.max(4, Math.min(96, value));
export function FormationBoard({
  slots,
  participants,
  isHost,
  editable,
  update,
  sides = ['HOME', 'AWAY'],
  heading = 'Formation',
  editableHint = 'Tap or drag players; drag empty slot space to reposition.',
  readonlyHint = 'The organiser controls the pre-match formation.',
  reserveLabels,
}: {
  slots: FormationSlot[];
  participants: MatchParticipant[];
  isHost: boolean;
  editable: boolean;
  update: Update;
  sides?: TeamSide[];
  heading?: string;
  editableHint?: string;
  readonlyHint?: string;
  reserveLabels?: Partial<Record<TeamSide, string>>;
}) {
  const [localSlots, setLocalSlots] = useState(slots);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [playerDrag, setPlayerDrag] = useState<PlayerDrag | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [landingSlotId, setLandingSlotId] = useState<string | null>(null);
  const pitch = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  useEffect(() => setLocalSlots(slots), [slots]);
  const onField = new Set(
    localSlots.flatMap((slot) => (slot.participantId ? [slot.participantId] : [])),
  );
  const reserves = participants.filter((item) => !onField.has(item.id));
  const save = async (slotId: string, input: Parameters<Update>[1]) => {
    const confirmed = localSlots;
    setSaving('saving');
    setLocalSlots((items) =>
      items.map((slot) =>
        slot.id === slotId
          ? {
              ...slot,
              ...input,
              participantId:
                input.participantId === undefined ? slot.participantId : input.participantId,
              participant: input.participantId
                ? participants.find((item) => item.id === input.participantId)
                : input.participantId === null
                  ? null
                  : slot.participant,
            }
          : input.participantId && slot.participantId === input.participantId
            ? { ...slot, participantId: null, participant: null }
            : slot,
      ),
    );
    try {
      await update(slotId, input);
      setSaving('saved');
      window.setTimeout(() => setSaving('idle'), 1200);
    } catch {
      setLocalSlots(confirmed);
      setSaving('error');
    }
  };
  const selectOrPlace = (slot: FormationSlot) => {
    if (!isHost || !editable) return;
    if (selected) {
      void save(slot.id, { participantId: selected });
      setSelected(null);
    } else if (slot.participantId) setSelected(slot.participantId);
  };
  const reserveSelected = () => {
    const slot = localSlots.find((item) => item.participantId === selected);
    if (slot) void save(slot.id, { participantId: null });
    setSelected(null);
  };

  const pointerPosition = (clientX: number, clientY: number) => {
    const rect = pitch.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      positionX: clampPercentage(((clientX - rect.left) / rect.width) * 100),
      positionY: clampPercentage(((clientY - rect.top) / rect.height) * 100),
      rect,
    };
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

  const startPlayerDrag = (event: React.PointerEvent<HTMLButtonElement>, slot: FormationSlot) => {
    // When a reserve is already selected, a tap on an occupied slot is a swap,
    // so leave the event to the existing tap-to-place interaction.
    if (!isHost || !editable || !slot.participantId || selected) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setPlayerDrag({
      participantId: slot.participantId,
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
    setPlayerDrag((current) =>
      current
        ? {
            ...current,
            positionX: position.positionX,
            positionY: position.positionY,
            active,
          }
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
    const target = playerDrag.active
      ? nearestDropTarget(event.clientX, event.clientY, playerDrag.sourceSlotId, playerDrag.team)
      : null;
    if (playerDrag.active) {
      suppressClick.current = true;
      const landingId = target?.id ?? playerDrag.sourceSlotId;
      setLandingSlotId(landingId);
      if (target) void save(target.id, { participantId: playerDrag.participantId });
      window.setTimeout(() => setLandingSlotId(null), 460);
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    } else {
      // Pointer-down is prevented to disable the browser drag ghost, so handle
      // a stationary tap explicitly instead of depending on a synthetic click.
      suppressClick.current = true;
      setSelected(playerDrag.participantId);
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
    setPlayerDrag(null);
    setDropTargetId(null);
  };
  const dragPosition = (event: React.PointerEvent, slot: FormationSlot) => {
    if (!isHost || !editable || selected || event.target !== event.currentTarget || !pitch.current)
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const finish = async (up: PointerEvent) => {
      const rect = pitch.current!.getBoundingClientRect();
      const positionX = Math.max(0, Math.min(100, ((up.clientX - rect.left) / rect.width) * 100));
      const positionY = Math.max(0, Math.min(100, ((up.clientY - rect.top) / rect.height) * 100));
      await save(slot.id, { positionX, positionY });
    };
    const element = event.currentTarget as HTMLButtonElement;
    element.onpointerup = (up) => {
      element.onpointerup = null;
      void finish(up);
    };
  };
  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-content-strong">{heading}</h2>
          <p className="text-sm text-content-muted">
            {isHost && editable ? editableHint : readonlyHint}
          </p>
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
        <div className="absolute inset-y-0 left-1/2 w-px bg-pitch-line/80" />
        <div className="absolute left-1/2 top-1/2 size-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-pitch-line/80" />
        <div className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pitch-line" />
        <div className="absolute left-1/2 top-0 h-20 w-1/2 -translate-x-1/2 border-2 border-t-0 border-pitch-line/80" />
        <div className="absolute bottom-0 left-1/2 h-20 w-1/2 -translate-x-1/2 border-2 border-b-0 border-pitch-line/80" />
        {localSlots.map((slot) => {
          const dragging = playerDrag?.sourceSlotId === slot.id;
          const dropTarget = dropTargetId === slot.id;
          const landing = landingSlotId === slot.id;
          return (
            <button
              key={slot.id}
              type="button"
              data-formation-slot-id={slot.id}
              onPointerDown={(event) =>
                slot.participantId ? startPlayerDrag(event, slot) : dragPosition(event, slot)
              }
              onPointerMove={movePlayerDrag}
              onPointerUp={finishPlayerDrag}
              onPointerCancel={finishPlayerDrag}
              onClick={() => {
                if (suppressClick.current) return;
                selectOrPlace(slot);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (selected) selectOrPlace(slot);
              }}
              className={`formation-marker absolute grid size-12 place-items-center rounded-full border-2 shadow-sm ${dragging ? 'formation-marker--dragging' : ''} ${dropTarget ? 'formation-marker--drop-target' : ''} ${landing ? 'formation-marker--landing' : ''} ${selected && (!slot.participantId || slot.participantId !== selected) ? 'formation-marker--selectable border-brand-200 bg-brand-50' : slot.team === 'HOME' ? 'border-team-home-border bg-team-home-muted text-team-home' : 'border-team-away-border bg-team-away-muted text-team-away'}`}
              style={{
                left: `${dragging ? playerDrag.positionX : slot.positionX}%`,
                top: `${dragging ? playerDrag.positionY : slot.positionY}%`,
                zIndex: dragging ? 30 : dropTarget ? 20 : 10,
              }}
              aria-label={`${slot.team} slot ${slot.slotIndex}${slot.participant?.user ? `, ${slot.participant.user.displayName}` : ', empty'}`}
            >
              {slot.participant?.user ? (
                <span className="formation-marker__avatar pointer-events-none">
                  <Avatar user={slot.participant.user} size="sm" />
                </span>
              ) : (
                <span className="pointer-events-none text-xs font-black">{slot.slotIndex}</span>
              )}
            </button>
          );
        })}
      </div>
      {selected && isHost && editable && (
        <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm font-semibold text-brand-700">
          <span>
            {participants.find((item) => item.id === selected)?.user?.displayName ?? 'Player'}{' '}
            selected
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={reserveSelected}>
              Move to reserves
            </Button>
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
            canEdit={isHost && editable}
            onSelect={setSelected}
            label={reserveLabels?.[team]}
          />
        ))}
      </div>
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
}: {
  team: TeamSide;
  players: MatchParticipant[];
  selected: string | null;
  canEdit: boolean;
  onSelect: (id: string) => void;
  label?: string;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${team === 'HOME' ? 'border-team-home-border bg-team-home-muted' : 'border-team-away-border bg-team-away-muted'}`}
    >
      <div className="mb-3 flex justify-between">
        <h3 className={`font-bold ${team === 'HOME' ? 'text-team-home' : 'text-team-away'}`}>
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
            draggable={canEdit}
            onDragStart={() => onSelect(player.id)}
            onClick={() => onSelect(player.id)}
            className={`flex items-center gap-2 rounded-xl border p-2 text-left ${selected === player.id ? 'border-brand-500 bg-surface' : 'border-line bg-surface/70'} disabled:cursor-default`}
          >
            <Avatar user={player.user!} size="sm" />
            <span className="truncate text-sm font-semibold text-content-strong">
              {player.user?.displayName}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
