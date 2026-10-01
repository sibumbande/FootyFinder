import type { PublicVenueDetail } from '@footy-finder/shared';

const LINK_NAMES: Record<PublicVenueDetail['links'][number]['type'], string> = {
  WEBSITE: 'Website', INSTAGRAM: 'Instagram', FACEBOOK: 'Facebook', X: 'X', TIKTOK: 'TikTok', OTHER: 'Link',
};

/** CEO touch-up batch 3, item 2: "About this venue" (plain text) and the venue's links, for members and guests. */
export function VenueAbout({ aboutText, links }: Pick<PublicVenueDetail, 'aboutText' | 'links'>) {
  return (
    <section className="grid gap-4 rounded-2xl border border-line bg-surface p-5" data-testid="venue-about">
      <h2 className="text-2xl font-black text-content-strong">About this venue</h2>
      {aboutText && <p className="max-w-3xl whitespace-pre-line leading-7 text-content">{aboutText}</p>}
      {links.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Venue links">
          {links.map((link) => (
            <li key={link.url}>
              <a
                className="inline-flex min-h-11 items-center gap-1 rounded-md border-2 border-line-strong bg-surface px-4 text-sm font-bold text-brand-700 hover:bg-surface-hover"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                {link.label || LINK_NAMES[link.type]}
                <span aria-hidden="true">↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
