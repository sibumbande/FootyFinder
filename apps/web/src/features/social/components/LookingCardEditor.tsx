import { FOOTBALL_POSITIONS, RECRUITMENT_NOTE_MAX, type LookingCardInput } from '@footy-finder/shared';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useMyLookingCard, useRecruitmentAction } from '../hooks/useRecruitment.js';
import { positionLabel } from '../recruitment-labels.js';
import { AvailabilityPicker, positionChip } from './AvailabilityPicker.js';

const field = 'min-h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm';

/** Gate 9 / TKT-909 (D13): the "Looking for a team" switch on your own profile, off by default. */
export function LookingCardEditor() {
  const card = useMyLookingCard();
  const action = useRecruitmentAction();
  const [input, setInput] = useState<LookingCardInput>({ enabled: false, positions: [], days: [], times: [] });
  useEffect(() => {
    if (card.data)
      setInput({ enabled: card.data.enabled, positions: card.data.positions, area: card.data.area ?? undefined, days: card.data.days, times: card.data.times, note: card.data.note ?? undefined });
  }, [card.data]);
  const set = (patch: Partial<LookingCardInput>) => setInput((current) => ({ ...current, ...patch }));
  const save = (next: LookingCardInput) => action.mutate({ kind: 'card', input: next });
  return (
    <section className="grid gap-4 rounded-2xl border border-line p-4" data-testid="looking-card-editor">
      <label className="flex items-center justify-between gap-4">
        <span>
          <span className="block text-sm font-black text-content-strong">Looking for a team</span>
          <span className="block text-xs text-content-muted">While this is on, teams can find you under "Players looking" and invite you. It switches off when you join a team.</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="size-5 accent-brand-600"
          checked={input.enabled}
          disabled={action.isPending || card.data?.removedByFootyFinder}
          onChange={(event) => {
            const next = { ...input, enabled: event.target.checked };
            setInput(next);
            if (!event.target.checked || next.positions.length) save(next);
          }}
          data-testid="looking-switch"
        />
      </label>
      {card.data?.removedByFootyFinder && <p className="text-sm text-danger-700">FootyFinder removed your card. Contact support if you think this was a mistake.</p>}
      {input.enabled && (
        <div className="grid gap-4">
          <fieldset className="grid gap-2">
            <legend className="text-sm font-bold text-content-strong">Positions</legend>
            <div className="flex flex-wrap gap-1.5">
              {FOOTBALL_POSITIONS.map((position) => (
                <button key={position} type="button" aria-pressed={input.positions.includes(position)} className={positionChip(input.positions.includes(position))}
                  onClick={() => set({ positions: input.positions.includes(position) ? input.positions.filter((item) => item !== position) : [...input.positions, position] })}>
                  {positionLabel(position)}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="grid gap-1 text-sm font-bold">
            Area
            <input className={field} value={input.area ?? ''} placeholder="e.g. Observatory" onChange={(event) => set({ area: event.target.value || undefined })} />
          </label>
          <AvailabilityPicker days={input.days} times={input.times} onChange={(value) => set(value)} />
          <label className="grid gap-1 text-sm font-bold">
            <span>Short note <span className="font-normal text-content-muted">({(input.note ?? '').length}/{RECRUITMENT_NOTE_MAX})</span></span>
            <textarea className={`${field} min-h-20 py-2`} maxLength={RECRUITMENT_NOTE_MAX} value={input.note ?? ''} onChange={(event) => set({ note: event.target.value || undefined })} />
          </label>
          <Button onClick={() => save(input)} loading={action.isPending} disabled={!input.positions.length}>Save card</Button>
        </div>
      )}
      <FormError message={action.error?.message} />
    </section>
  );
}
