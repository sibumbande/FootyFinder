import { Link } from 'react-router-dom';

/** CEO touch-up batch 3, item 1: the venue's cover photo at the top of a match page (members and guests). */
export function MatchVenuePhoto({ venue }: { venue: { name: string; venueSlug?: string; coverImage?: { url: string; altText: string } } }) {
  if (!venue.coverImage) return null;
  const image = (
    <img
      src={venue.coverImage.url}
      alt={venue.coverImage.altText || `Photo of ${venue.name}`}
      className="h-36 w-full rounded-2xl object-cover sm:h-48"
      loading="lazy"
    />
  );
  return (
    <div className="mb-5" data-testid="match-venue-photo">
      {venue.venueSlug ? <Link to={`/venues/${venue.venueSlug}`} aria-label={`About ${venue.name}`}>{image}</Link> : image}
    </div>
  );
}
