import type { PublicVenueCard } from '@footy-finder/shared';
import { Link } from 'react-router-dom';

export function VenueCard({ venue }: { venue: PublicVenueCard }) {
  return <Link to={`/venues/${venue.slug}`} className="group overflow-hidden rounded-3xl border border-line bg-surface shadow-soft transition hover:-translate-y-1">
    <div className="aspect-[16/10] overflow-hidden bg-surface-muted"><img className="h-full w-full object-cover transition duration-300 group-hover:scale-105" src={venue.coverImage.url} alt={venue.coverImage.altText} /></div>
    <div className="grid gap-2 p-5">
      <div className="flex items-start justify-between gap-4"><h3 className="text-xl font-black text-content-strong">{venue.name}</h3></div>
      <p className="text-sm text-content-muted">{venue.city}, {venue.region}</p>
      <p className="text-xs font-bold uppercase tracking-wide text-content-muted">{venue.supportedFormats.map((format) => format.replaceAll('_', ' ')).join(' · ')}</p>
      <p className="text-xs text-content-subtle">60-minute Quick Matches · R80 per player</p>
    </div>
  </Link>;
}
