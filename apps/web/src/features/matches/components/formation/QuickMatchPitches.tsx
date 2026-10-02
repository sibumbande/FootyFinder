import type { TeamSide } from '@footy-finder/shared';
import { useMemo, useState } from 'react';
import {
  QUICK_MATCH_RESERVE_LABELS,
  QUICK_MATCH_SIDE_BADGES,
  QUICK_MATCH_SIDE_LABELS,
} from '../../constants/quick-match-sides.js';
import { FormationBoard, type FormationBoardPlayer, type FormationBoardSlot } from './FormationBoard.js';

const SIDES: TeamSide[] = ['HOME', 'AWAY'];
const SIDE_NAME: Record<TeamSide, string> = { HOME: 'Home', AWAY: 'Away' };

/**
 * Stored Quick Match positions share one pitch: Home defends the bottom goal and Away the top one
 * (away y = 100 - home y). On its own pitch every side defends the bottom goal, so Away is turned
 * around for display and turned back when the Host saves a move.
 */
export const toSidePitch = (team: TeamSide, positionY: number) => (team === 'AWAY' ? 100 - positionY : positionY);

type Assignment = Parameters<React.ComponentProps<typeof FormationBoard>['onAssign']>[0];

/**
 * CEO batch 1, item 3: a Quick Match formation on two pitches, "Team A · Home" and "Team B · Away",
 * each in its side's colours (Away stays red). Side by side from tablet width up; on phones, Home
 * and Away tabs that open on the viewer's own side. Only the Host moves markers (`canEdit`);
 * players claim, swap or leave positions exactly as before.
 */
export function QuickMatchPitches({
  slots,
  players,
  canEdit,
  claimableSlotIds,
  onClaim,
  buyableSlotIds,
  onBuy,
  bookedSlotIds,
  currentPlayerId,
  currentSide,
  readonlyHint,
  onAssign,
  onRemove,
  onMove,
}: {
  slots: FormationBoardSlot[];
  players: FormationBoardPlayer[];
  canEdit: boolean;
  claimableSlotIds: readonly string[];
  onClaim: (slotId: string) => Promise<unknown>;
  /** DEC-021 A1: open positions a viewer who is not in the match can buy a ticket for. */
  buyableSlotIds?: readonly string[];
  onBuy?: (slotId: string) => void;
  /** DEC-021 A1.2: positions someone is paying for right now. */
  bookedSlotIds?: readonly string[];
  currentPlayerId: string | null;
  currentSide: TeamSide | null;
  readonlyHint: string;
  onAssign: (input: Assignment) => Promise<unknown>;
  onRemove: (slotId: string) => Promise<unknown>;
  onMove: (slotId: string, position: { positionX: number; positionY: number }) => Promise<unknown>;
}) {
  const [shown, setShown] = useState<TeamSide>(currentSide ?? 'HOME');
  const bySide = useMemo(
    () =>
      Object.fromEntries(
        SIDES.map((team) => [
          team,
          {
            slots: slots
              .filter((slot) => slot.team === team)
              .map((slot) => ({ ...slot, positionY: toSidePitch(team, Number(slot.positionY)) })),
            players: players.filter((player) => player.team === team),
          },
        ]),
      ) as Record<TeamSide, { slots: FormationBoardSlot[]; players: FormationBoardPlayer[] }>,
    [slots, players],
  );

  return (
    <div className="grid gap-4">
      <div role="tablist" aria-label="Pitches" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-muted p-1 md:hidden">
        {SIDES.map((team) => (
          <button
            key={team}
            type="button"
            role="tab"
            aria-selected={shown === team}
            onClick={() => setShown(team)}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 text-sm font-bold ${shown === team ? `bg-surface shadow-sm ${team === 'HOME' ? 'text-team-home' : 'text-team-away'}` : 'text-content-muted'}`}
          >
            <span
              aria-hidden="true"
              className={`grid size-5 place-items-center rounded-full text-[10px] font-black text-on-team ${team === 'HOME' ? 'bg-team-home' : 'bg-team-away'}`}
            >
              {QUICK_MATCH_SIDE_BADGES[team]}
            </span>
            {SIDE_NAME[team]}
          </button>
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {SIDES.map((team) => (
          <div
            key={team}
            data-testid={`pitch-${team.toLowerCase()}`}
            className={`${shown === team ? 'block' : 'hidden'} min-w-0 rounded-2xl border-2 p-3 md:block ${team === 'HOME' ? 'border-team-home-border' : 'border-team-away-border'}`}
          >
            <FormationBoard
              slots={bySide[team].slots}
              players={bySide[team].players}
              sides={[team]}
              pitchMode="single-team"
              heading={`${QUICK_MATCH_SIDE_LABELS[team]} · ${SIDE_NAME[team]}`}
              canEdit={canEdit}
              claimableSlotIds={claimableSlotIds}
              onClaim={onClaim}
              buyableSlotIds={buyableSlotIds}
              onBuy={onBuy}
              bookedSlotIds={bookedSlotIds}
              currentPlayerId={currentPlayerId}
              sideLabels={QUICK_MATCH_SIDE_LABELS}
              sideBadges={QUICK_MATCH_SIDE_BADGES}
              reserveLabels={QUICK_MATCH_RESERVE_LABELS}
              emptySlotsAreOpen
              editableHint="Drag a marker anywhere on this pitch, or tap a player and then a position."
              readonlyHint={readonlyHint}
              onAssign={onAssign}
              onRemove={onRemove}
              onMove={(slotId, position) =>
                onMove(slotId, { positionX: position.positionX, positionY: toSidePitch(team, position.positionY) })
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
