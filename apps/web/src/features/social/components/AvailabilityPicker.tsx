import { TIMES_OF_DAY, WEEKDAY_LABELS, type TimeOfDay } from '@footy-finder/shared';
import { TIME_LABELS } from '../recruitment-labels.js';

export const positionChip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${on ? 'border-brand-600 bg-brand-600 text-content-inverse' : 'border-line bg-surface text-content-muted hover:text-content-strong'}`;

function toggle<T>(list: T[], item: T) {
  return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
}

/** Usual days and times of day (none chosen = any). */
export function AvailabilityPicker({ days, times, onChange }: { days: number[]; times: TimeOfDay[]; onChange: (value: { days: number[]; times: TimeOfDay[] }) => void }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-bold text-content-strong">
        Usual days and times <span className="font-normal text-content-muted">(none = any)</span>
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {[1, 2, 3, 4, 5, 6, 0].map((day) => (
          <button key={day} type="button" aria-pressed={days.includes(day)} className={positionChip(days.includes(day))} onClick={() => onChange({ days: toggle(days, day), times })}>
            {WEEKDAY_LABELS[day]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TIMES_OF_DAY.map((time) => (
          <button key={time} type="button" aria-pressed={times.includes(time)} className={positionChip(times.includes(time))} onClick={() => onChange({ days, times: toggle(times, time) })}>
            {TIME_LABELS[time]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
