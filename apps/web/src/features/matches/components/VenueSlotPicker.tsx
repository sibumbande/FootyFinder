import { MATCH_FORMAT_CONFIG, type MatchFormat } from '@footy-finder/shared';
import { useEffect, useState } from 'react';
import { FormError } from '@/components/ui/FormError.js';
import { useVenue, useVenueSlots, useVenues } from '@/features/venues/hooks/useVenues.js';

const localToday = () => new Date().toISOString().slice(0, 10);
const field = 'min-h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm';

export type PickedSlot = { venue: string; fieldId: string; format: MatchFormat; startsAt: string };

/**
 * The venue and slot step of the create-match wizard, inside the wizard: choosing a slot never
 * leaves the page, so nothing entered earlier is lost. A quick match only offers slots in the
 * format already chosen; a team match takes its format from the slot.
 */
export function VenueSlotPicker({
  format,
  selected,
  onPick,
}: {
  format?: MatchFormat;
  selected: { venue: string; fieldId: string; startsAt: string };
  onPick: (slot: PickedSlot) => void;
}) {
  const venues = useVenues();
  const [venueSlug, setVenueSlug] = useState(selected.venue);
  const venue = useVenue(venueSlug);
  const fields = (venue.data?.venue.fields ?? []).filter((item) => !format || item.supportedFormats.includes(format));
  const [fieldId, setFieldId] = useState(selected.fieldId);
  const chosenField = fields.find((item) => item.id === fieldId);
  const [slotFormat, setSlotFormat] = useState<MatchFormat>(format ?? 'FIVE_A_SIDE');
  const [date, setDate] = useState(selected.startsAt ? selected.startsAt.slice(0, 10) : localToday());
  useEffect(() => {
    if (fields.length && !chosenField) setFieldId(fields[0]!.id);
  }, [fields, chosenField]);
  useEffect(() => {
    if (format) setSlotFormat(format);
    else if (chosenField && !chosenField.supportedFormats.includes(slotFormat)) setSlotFormat(chosenField.supportedFormats[0] ?? 'FIVE_A_SIDE');
  }, [format, chosenField, slotFormat]);
  const slots = useVenueSlots(venueSlug, chosenField?.id ?? '', slotFormat, date, date);
  const venueList = (venues.data ?? []).filter((item) => !format || item.supportedFormats.includes(format));

  return (
    <div className="grid gap-5" data-testid="venue-slot-picker">
      <FormError message={venues.error?.message} />
      <div className="grid gap-3 sm:grid-cols-2">
        {venueList.map((item) => (
          <button
            key={item.slug}
            type="button"
            aria-pressed={venueSlug === item.slug}
            onClick={() => {
              setVenueSlug(item.slug);
              setFieldId('');
            }}
            className={`flex items-center gap-3 rounded-2xl border p-3 text-left ${venueSlug === item.slug ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface hover:bg-surface-hover'}`}
          >
            <img className="size-14 shrink-0 rounded-xl object-cover" src={item.coverImage.url} alt="" />
            <span className="min-w-0">
              <span className="block truncate font-black text-content-strong">{item.name}</span>
              <span className="block text-xs text-content-muted">{item.city} · {item.supportedFormats.map((value) => MATCH_FORMAT_CONFIG[value].shortLabel).join(', ')}</span>
            </span>
          </button>
        ))}
      </div>
      {venues.data && venueList.length === 0 && (
        <p className="rounded-xl bg-surface-muted p-4 text-sm text-content-muted">No venue offers this format yet. Go back and choose another format.</p>
      )}
      {venueSlug && venue.data && (
        <div className="grid gap-4 rounded-2xl border border-line p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm font-bold">
              Field
              <select className={field} value={chosenField?.id ?? ''} onChange={(event) => setFieldId(event.target.value)}>
                {fields.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-bold">
              Format
              <select className={field} value={slotFormat} disabled={Boolean(format)} onChange={(event) => setSlotFormat(event.target.value as MatchFormat)}>
                {(chosenField?.supportedFormats ?? [slotFormat]).map((item) => <option key={item} value={item}>{MATCH_FORMAT_CONFIG[item].label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-bold">
              Date
              <input className={field} type="date" min={localToday()} value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
          </div>
          <p className="text-xs text-content-muted">Times are shown in {venue.data.venue.timezone}. Every match lasts 60 minutes.</p>
          <FormError message={slots.error?.message} />
          {slots.isPending && chosenField && <div className="h-16 animate-pulse rounded-xl bg-surface-muted" />}
          {slots.data?.length === 0 && <p className="rounded-xl bg-surface-muted p-4 text-sm text-content-muted">No free slots on this date. Try another day.</p>}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {slots.data?.map((slot) => {
              const active = selected.startsAt === slot.startsAt && selected.fieldId === slot.fieldId;
              return (
                <button
                  key={`${slot.fieldId}:${slot.startsAt}`}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onPick({ venue: venueSlug, fieldId: slot.fieldId, format: slot.format, startsAt: slot.startsAt })}
                  className={`min-h-11 rounded-xl border p-2 text-center font-bold ${active ? 'border-brand-600 bg-brand-600 text-content-inverse' : 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100'}`}
                >
                  {slot.localTime}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
