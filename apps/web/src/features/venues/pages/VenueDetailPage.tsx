import { TERMS_ANCHORS, type MatchFormat } from '@footy-finder/shared';
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { FormError } from '@/components/ui/FormError.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { GuestAction } from '@/features/public/components/SignUpPrompt.js';
import { VenueAbout } from '../components/VenueAbout.js';
import { useVenue, useVenueSlots } from '../hooks/useVenues.js';

const localToday = () => new Date().toISOString().slice(0, 10);
export function VenueDetailPage() {
  const [params] = useSearchParams(); const playAs = params.get('playAs');
  const playAsSuffix = playAs?.startsWith('team:') ? `&playAs=${encodeURIComponent(playAs)}${params.get('lock') === '1' ? '&lock=1' : ''}` : '';
  const { slug = '' } = useParams(); const venueQuery = useVenue(slug); const venue = venueQuery.data?.venue;
  const [fieldId, setFieldId] = useState(''); const [format, setFormat] = useState<MatchFormat>('FIVE_A_SIDE'); const [date, setDate] = useState(localToday());
  useEffect(() => { if (!venue || fieldId) return; const field = venue.fields[0]; if (field) { setFieldId(field.id); setFormat(field.supportedFormats[0] ?? 'FIVE_A_SIDE'); } }, [venue, fieldId]);
  const field = venue?.fields.find(({ id }) => id === fieldId);
  useEffect(() => { if (field && !field.supportedFormats.includes(format)) setFormat(field.supportedFormats[0] ?? 'FIVE_A_SIDE'); }, [field, format]);
  const slots = useVenueSlots(slug, fieldId, format, date, date);
  const { user } = useAuth();
  if (venueQuery.data?.wasAlias) return <Navigate replace to={`/venues/${venueQuery.data.canonicalSlug}`} />;
  if (venueQuery.isPending) return <div className="h-96 animate-pulse rounded-3xl bg-surface" />;
  if (!venue) return <FormError message={venueQuery.error?.message ?? 'Venue not found.'} />;
  return <section className="grid gap-7">
    <div className="overflow-hidden rounded-3xl border border-line bg-surface"><img className="max-h-[30rem] w-full object-cover" src={venue.coverImage.url} alt={venue.coverImage.altText} /><div className="grid gap-3 p-6"><p className="anime-kicker">{venue.city}</p><h1 className="text-4xl font-black uppercase text-content-strong">{venue.name}</h1><p className="max-w-3xl leading-7 text-content-muted">{venue.description}</p><p className="text-sm text-content">{venue.addressLine1}{venue.addressLine2 ? `, ${venue.addressLine2}` : ''}</p></div></div>
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <aside className="grid content-start gap-4 rounded-2xl border border-line bg-surface p-5"><label className="grid gap-2 text-sm font-bold">Field<select className="rounded-xl border border-line bg-canvas p-3" value={fieldId} onChange={(event) => setFieldId(event.target.value)}>{venue.fields.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="grid gap-2 text-sm font-bold">Format<select className="rounded-xl border border-line bg-canvas p-3" value={format} onChange={(event) => setFormat(event.target.value as MatchFormat)}>{field?.supportedFormats.map((item) => <option key={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><label className="grid gap-2 text-sm font-bold">Date<input className="rounded-xl border border-line bg-canvas p-3" type="date" min={localToday()} value={date} onChange={(event) => setDate(event.target.value)} /></label></aside>
      <div className="rounded-2xl border border-line bg-surface p-5"><h2 className="text-2xl font-black text-content-strong">Available 60-minute slots</h2><p className="mt-1 text-sm text-content-muted">Times are shown in {venue.timezone}. Only server-calculated slots can be selected.</p>{slots.isPending && <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-xl bg-surface-muted" />)}</div>}<FormError message={slots.error?.message} />{slots.data?.length === 0 && <p className="mt-5 rounded-xl bg-surface-muted p-4 text-content-muted">No selectable slots for this date.</p>}<div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{slots.data?.map((slot) => { const createUrl = `/matches/new?venue=${encodeURIComponent(slug)}&field=${slot.fieldId}&format=${slot.format}&startsAt=${encodeURIComponent(slot.startsAt)}${playAsSuffix}`; return user ? <Link key={slot.startsAt} to={createUrl} className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-center font-bold text-brand-700 hover:bg-brand-100"><span className="block text-lg">{slot.localTime}</span><span className="text-xs">60-minute slot</span></Link> : <div key={slot.startsAt} className="grid gap-2 rounded-xl border border-brand-200 bg-brand-50 p-3 text-center font-bold text-brand-700"><span className="block text-lg">{slot.localTime}</span><GuestAction action="book this slot" returnTo={createUrl} className="inline-flex min-h-8 items-center justify-center rounded-md border-2 border-brand-900 bg-brand-600 px-2 py-1 text-[11px] font-black uppercase tracking-[0.06em] text-content-inverse" /></div>; })}</div></div>
    </div>
    {/* CEO touch-up batch 3, item 1: uploaded photos show as thumbnails that open the full photo. */}
    {venue.gallery.length > 0 && <section aria-label="Venue photos" className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="venue-gallery">{venue.gallery.map((image) => <figure key={image.url}><a href={image.url} target="_blank" rel="noopener noreferrer"><img className="aspect-[4/3] w-full rounded-2xl object-cover" src={image.thumbUrl ?? image.url} alt={image.altText} loading="lazy" /></a><figcaption className="mt-1 text-xs text-content-subtle">{image.attribution}</figcaption></figure>)}</section>}
    {(venue.aboutText || venue.links.length > 0) && <VenueAbout aboutText={venue.aboutText} links={venue.links} />}
    <p className="rounded-xl bg-surface-muted p-4 text-sm text-content-muted">Cancellations and refunds follow the FootyFinder match rules in <Link className="font-bold text-brand-700 underline" to={`/legal/terms#${TERMS_ANCHORS.cancellations}`}>Terms clause 14</Link>.</p>
  </section>;
}
