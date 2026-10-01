import type {
  ManagedField,
  ManagedFieldAvailabilityInput,
  ManagedFieldInput,
  ManagedVenue,
  ManagedVenueInput,
  MatchFormat,
} from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { adminClient } from './api.js';
import { FieldClosures } from './FieldClosures.js';
import { VenuePhotos } from './VenuePhotos.js';

const venuesKey = ['admin', 'venues'] as const;
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const formats = ['FIVE_A_SIDE', 'SEVEN_A_SIDE', 'ELEVEN_A_SIDE'] as const;
const formatLabel = (format: string) => format.replaceAll('_', ' ').toLowerCase();
const minuteLabel = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const timeMinute = (value: string) => {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
};
const venueInput = (venue: ManagedVenue): ManagedVenueInput => ({
  slug: venue.slug,
  name: venue.name,
  ...(venue.publicDescription ? { publicDescription: venue.publicDescription } : {}),
  addressLine1: venue.addressLine1,
  ...(venue.addressLine2 ? { addressLine2: venue.addressLine2 } : {}),
  city: venue.city,
  region: venue.region,
  ...(venue.postalCode ? { postalCode: venue.postalCode } : {}),
  countryCode: venue.countryCode,
  ...(venue.latitude !== undefined ? { latitude: venue.latitude } : {}),
  ...(venue.longitude !== undefined ? { longitude: venue.longitude } : {}),
  timezone: venue.timezone,
  amenities: venue.amenities,
  ...(venue.coverImageUrl ? { coverImageUrl: venue.coverImageUrl } : {}),
  ...(venue.coverImageAlt ? { coverImageAlt: venue.coverImageAlt } : {}),
  ...(venue.coverImageAttribution ? { coverImageAttribution: venue.coverImageAttribution } : {}),
  isActive: venue.isActive,
});

function ErrorText({ error }: { error: Error | null }) {
  return error ? <p className="error">{error.message}</p> : null;
}

function FieldEditor({ field }: { field: ManagedField }) {
  const cache = useQueryClient();
  const updateVenue = (venue: ManagedVenue) =>
    cache.setQueryData<ManagedVenue[]>(venuesKey, (current = []) =>
      current.map((item) => (item.id === venue.id ? venue : item)),
    );
  const [periods, setPeriods] = useState<ManagedFieldAvailabilityInput['periods']>(
    field.availabilityPeriods.map(({ dayOfWeek, startMinute, endMinute }) => ({
      dayOfWeek,
      startMinute,
      endMinute,
    })),
  );
  const [day, setDay] = useState(1);
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('22:00');
  const [price, setPrice] = useState('800');
  const [priceFrom, setPriceFrom] = useState('');
  const [priceTo, setPriceTo] = useState('');
  const [priceFormat, setPriceFormat] = useState<MatchFormat | ''>('');
  const [priceDay, setPriceDay] = useState('');
  const [priceStart, setPriceStart] = useState('08:00');
  const [priceEnd, setPriceEnd] = useState('22:00');
  const [status, setStatus] = useState<ManagedField['status']>(field.status);
  const [bufferMinutes, setBufferMinutes] = useState(field.turnaroundBufferMinutes);
  const mutation = useMutation({
    mutationFn: (action: () => Promise<{ data: ManagedVenue }>) => action(),
    onSuccess: ({ data }) => updateVenue(data),
  });
  const fieldInput = (): ManagedFieldInput => ({
    name: field.name,
    ...(field.description ? { description: field.description } : {}),
    status,
    turnaroundBufferMinutes: bufferMinutes,
    supportedFormats: field.supportedFormats,
  });
  return (
    <article className="field-card">
      <header className="row between">
        <div>
          <h4>{field.name}</h4>
          <p className="muted">{field.supportedFormats.map(formatLabel).join(' · ')}</p>
        </div>
        <label className="compact">
          Field status
          <select value={status} onChange={(event) => setStatus(event.target.value as ManagedField['status'])}>
            <option value="ACTIVE">Active</option>
            <option value="MAINTENANCE">Maintenance</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>
        <label className="compact">Turnaround buffer<input type="number" min="15" max="240" value={bufferMinutes} onChange={(event) => setBufferMinutes(Number(event.target.value))} /></label>
        <button
          className="small"
          disabled={mutation.isPending || (status === field.status && bufferMinutes === field.turnaroundBufferMinutes)}
          onClick={() => mutation.mutate(() => adminClient.updateField(field.id, fieldInput()))}
        >
          Save field settings
        </button>
      </header>

      <details>
        <summary>Weekly operating hours</summary>
        <div className="stack inset">
          {periods.map((period, index) => (
            <div className="row between" key={`${period.dayOfWeek}-${period.startMinute}-${index}`}>
              <span>{days[period.dayOfWeek]} · {minuteLabel(period.startMinute)}–{minuteLabel(period.endMinute)}</span>
              <button className="danger small" onClick={() => setPeriods((current) => current.filter((_, item) => item !== index))}>Remove</button>
            </div>
          ))}
          <div className="form-grid four">
            <label>Day<select value={day} onChange={(event) => setDay(Number(event.target.value))}>{days.map((label, index) => <option value={index} key={label}>{label}</option>)}</select></label>
            <label>Opens<input type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label>
            <label>Closes<input type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
            <button onClick={() => setPeriods((current) => [...current, { dayOfWeek: day, startMinute: timeMinute(start), endMinute: timeMinute(end) }])}>Add period</button>
          </div>
          <button disabled={mutation.isPending} onClick={() => mutation.mutate(() => adminClient.replaceFieldAvailability(field.id, { periods }))}>Save weekly hours</button>
        </div>
      </details>

      <details>
        <summary>Closures (one-off and weekly)</summary>
        <FieldClosures field={field} venuesKey={venuesKey} />
        {field.exceptions.length > 0 && (
          <div className="stack inset">
            <p className="muted">Older availability exceptions (removing one returns the venue to draft):</p>
            {field.exceptions.map((exception) => (
              <div className="row between" key={exception.id}>
                <span><strong>{exception.available ? 'Open' : 'Closed'}</strong> · {new Date(exception.startsAt).toLocaleString()}–{new Date(exception.endsAt).toLocaleString()} {exception.reason ? `· ${exception.reason}` : ''}</span>
                <button className="danger small" disabled={mutation.isPending} onClick={() => mutation.mutate(() => adminClient.removeFieldException(field.id, exception.id))}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </details>

      <details>
        <summary>Effective price history</summary>
        <div className="stack inset">
          {field.prices.map((item) => (
            <div key={item.id} className="price-row">
              <strong>R {(item.amountCents / 100).toFixed(2)}</strong>
              <span>{new Date(item.effectiveFrom).toLocaleString()} → {item.effectiveTo ? new Date(item.effectiveTo).toLocaleString() : 'ongoing'}</span>
            </div>
          ))}
          <p className="muted">Price records are immutable. Add a non-overlapping effective period to preserve history.</p>
          <form className="form-grid three" onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate(() => adminClient.addFieldPrice(field.id, {
              amountCents: Math.round(Number(price) * 100),
              ...(priceFormat ? { format: priceFormat } : {}),
              ...(priceDay ? { dayOfWeek: Number(priceDay), startMinute: timeMinute(priceStart), endMinute: timeMinute(priceEnd) } : {}),
              effectiveFrom: new Date(priceFrom).toISOString(),
              ...(priceTo ? { effectiveTo: new Date(priceTo).toISOString() } : {}),
            }));
          }}>
            <label>Price (R)<input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} required /></label>
            <label>Effective from<input type="datetime-local" value={priceFrom} onChange={(event) => setPriceFrom(event.target.value)} required /></label>
            <label>Effective to (optional)<input type="datetime-local" value={priceTo} onChange={(event) => setPriceTo(event.target.value)} /></label>
            <label>Format scope<select value={priceFormat} onChange={(event) => setPriceFormat(event.target.value as MatchFormat | '')}><option value="">All formats</option>{field.supportedFormats.map((item) => <option key={item} value={item}>{formatLabel(item)}</option>)}</select></label>
            <label>Day/time scope<select value={priceDay} onChange={(event) => setPriceDay(event.target.value)}><option value="">All operating hours</option>{days.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label>
            {priceDay && <><label>Scope starts<input type="time" value={priceStart} onChange={(event) => setPriceStart(event.target.value)} /></label><label>Scope ends<input type="time" value={priceEnd} onChange={(event) => setPriceEnd(event.target.value)} /></label></>}
            <button disabled={mutation.isPending}>Add immutable price</button>
          </form>
        </div>
      </details>
      <ErrorText error={mutation.error} />
    </article>
  );
}

function VenueCard({ venue }: { venue: ManagedVenue }) {
  const cache = useQueryClient();
  const [fieldName, setFieldName] = useState('');
  const [selectedFormats, setSelectedFormats] = useState<ManagedFieldInput['supportedFormats']>(['FIVE_A_SIDE']);
  const [deactivationReason, setDeactivationReason] = useState('');
  const [publicDescription, setPublicDescription] = useState(venue.publicDescription ?? '');
  const [latitude, setLatitude] = useState(venue.latitude?.toString() ?? '');
  const [longitude, setLongitude] = useState(venue.longitude?.toString() ?? '');
  const [amenities, setAmenities] = useState(venue.amenities.join(', '));
  const [policyFrom, setPolicyFrom] = useState('');
  const [policyTo, setPolicyTo] = useState('');
  const [policyText, setPolicyText] = useState('Full credit more than 24 hours before kickoff; no credit within 24 hours. Venue or platform cancellation receives full credit.');
  const mutation = useMutation({
    mutationFn: (action: () => Promise<{ data: ManagedVenue }>) => action(),
    onSuccess: ({ data }) => cache.setQueryData<ManagedVenue[]>(venuesKey, (current = []) => current.map((item) => item.id === data.id ? data : item)),
  });
  return (
    <article className="venue-card">
      <header className="row between">
        <div><h3>{venue.name}</h3><p className="muted">{venue.addressLine1}, {venue.city} · {venue.timezone}</p></div>
        <strong>{venue.publicationStatus.replaceAll('_', ' ')}</strong>
      </header>
      <details>
        <summary>Public listing, photos, and cancellation policy</summary>
        <div className="stack inset">
          <label>Public description<textarea minLength={20} value={publicDescription} onChange={(event) => setPublicDescription(event.target.value)} /></label>
          <div className="form-grid two">
            <label>Latitude<input type="number" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label>
            <label>Longitude<input type="number" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label>
            <label>Amenities (comma separated)<input value={amenities} onChange={(event) => setAmenities(event.target.value)} /></label>
          </div>
          <button disabled={mutation.isPending || !latitude || !longitude} onClick={() => mutation.mutate(() => adminClient.updateVenue(venue.id, { ...venueInput(venue), publicDescription, latitude: Number(latitude), longitude: Number(longitude), amenities: amenities.split(',').map((item) => item.trim()).filter(Boolean) }))}>Save public listing</button>
          <VenuePhotos venue={venue} venuesKey={venuesKey} />
          <div className="form-grid two">
            <label>Policy effective from<input type="datetime-local" value={policyFrom} onChange={(event) => setPolicyFrom(event.target.value)} /></label>
            <label>Policy effective to (optional)<input type="datetime-local" value={policyTo} onChange={(event) => setPolicyTo(event.target.value)} /></label>
            <label>Policy text<textarea value={policyText} onChange={(event) => setPolicyText(event.target.value)} /></label>
          </div>
          <button disabled={mutation.isPending || !policyFrom} onClick={() => mutation.mutate(() => adminClient.addVenueCancellationPolicy(venue.id, { effectiveFrom: new Date(policyFrom).toISOString(), ...(policyTo ? { effectiveTo: new Date(policyTo).toISOString() } : {}), fullCreditBeforeHours: 24, lateCreditPercent: 0, venueCancellationPercent: 100, policyText }))}>Add effective policy</button>
        </div>
      </details>
      <div className="stack inset">
        <p className="muted">Publishing requires a second MFA-verified admin. Catalogue changes return a published venue to draft.</p>
        <div className="row">
          {venue.publicationStatus === 'DRAFT' && <button disabled={mutation.isPending} onClick={() => mutation.mutate(() => adminClient.submitVenue(venue.id))}>Submit for independent approval</button>}
          {venue.publicationStatus === 'PENDING_APPROVAL' && <button disabled={mutation.isPending} onClick={() => mutation.mutate(() => adminClient.approveVenue(venue.id))}>Approve and publish</button>}
        </div>
        {venue.publicationStatus === 'PUBLISHED' && <div className="form-grid two"><label>Emergency deactivation reason<input value={deactivationReason} onChange={(event) => setDeactivationReason(event.target.value)} /></label><button className="danger" disabled={mutation.isPending || deactivationReason.trim().length < 3} onClick={() => mutation.mutate(() => adminClient.deactivateVenue(venue.id, deactivationReason))}>Emergency deactivate</button></div>}
      </div>
      <div className="stack">{venue.fields.map((field) => <FieldEditor key={field.id} field={field} />)}</div>
      <details>
        <summary>Add a field or court</summary>
        <form className="stack inset" onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(() => adminClient.createField(venue.id, { name: fieldName, status: 'ACTIVE', supportedFormats: selectedFormats }), { onSuccess: () => setFieldName('') });
        }}>
          <label>Field name<input value={fieldName} onChange={(event) => setFieldName(event.target.value)} required /></label>
          <fieldset><legend>Supported formats</legend>{formats.map((format) => <label className="check" key={format}><input type="checkbox" checked={selectedFormats.includes(format)} onChange={(event) => setSelectedFormats((current) => event.target.checked ? [...current, format] : current.filter((item) => item !== format))} />{formatLabel(format)}</label>)}</fieldset>
          <button disabled={mutation.isPending || selectedFormats.length === 0}>Add field</button>
        </form>
      </details>
      <ErrorText error={mutation.error} />
    </article>
  );
}

export function VenuesPage() {
  const cache = useQueryClient();
  const [input, setInput] = useState<ManagedVenueInput>({ name: '', addressLine1: '', city: '', region: '', countryCode: 'ZA', timezone: 'Africa/Johannesburg', isActive: true });
  const query = useQuery({ queryKey: venuesKey, queryFn: async () => (await adminClient.venues()).data });
  const create = useMutation({
    mutationFn: () => adminClient.createVenue(input),
    onSuccess: ({ data }) => {
      cache.setQueryData<ManagedVenue[]>(venuesKey, (current = []) => [...current, data]);
      setInput({ name: '', addressLine1: '', city: '', region: '', countryCode: 'ZA', timezone: 'Africa/Johannesburg', isActive: true });
    },
  });
  const set = (key: keyof ManagedVenueInput, value: string) => setInput((current) => ({ ...current, [key]: value }));
  return (
    <section>
      <div><p className="eyebrow">Bookable inventory</p><h2>Venues & fields</h2><p className="muted">Manage facilities, operating windows, exceptions, formats, and effective-dated ZAR pricing.</p></div>
      <details className="create-panel"><summary>Create venue</summary>
        <form className="form-grid two inset" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }}>
          <label>Name<input value={input.name} onChange={(event) => set('name', event.target.value)} required /></label>
          <label>Address<input value={input.addressLine1} onChange={(event) => set('addressLine1', event.target.value)} required /></label>
          <label>City<input value={input.city} onChange={(event) => set('city', event.target.value)} required /></label>
          <label>Region / province<input value={input.region} onChange={(event) => set('region', event.target.value)} required /></label>
          <label>Country code<input maxLength={2} value={input.countryCode} onChange={(event) => set('countryCode', event.target.value)} required /></label>
          <label>Timezone<input value={input.timezone} onChange={(event) => set('timezone', event.target.value)} required /></label>
          <button disabled={create.isPending}>Create venue</button>
          <ErrorText error={create.error} />
        </form>
      </details>
      {query.isPending && <p>Loading catalogue…</p>}
      <ErrorText error={query.error} />
      <div className="stack">{query.data?.map((venue) => <VenueCard key={venue.id} venue={venue} />)}</div>
      {query.data?.length === 0 && <p className="empty">No managed venues yet. Create the first venue above.</p>}
    </section>
  );
}
