import type { PublicVenueCard } from '@footy-finder/shared';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { VenueCard } from './VenueCard.js';

/**
 * CEO touch-up batch 3, item 8: venue cards in a horizontal carousel that swipes. Phones show one card with a peek
 * of the next; tablets and desktops add previous/next arrows, shown only when there is more to scroll. A single
 * venue simply fills the row (no arrows, no gaps). The track is keyboard-focusable: arrow keys move it, and Tab
 * reaches each card.
 */
export function VenueCarousel({ venues, search = '' }: { venues: PublicVenueCard[]; search?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const update = useCallback(() => {
    const element = track.current;
    if (!element) return;
    setEdges({ start: element.scrollLeft <= 4, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [update, venues.length]);
  const scroll = (direction: -1 | 1) => {
    const element = track.current;
    if (element) element.scrollBy({ left: direction * element.clientWidth * 0.85, behavior: 'smooth' });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      scroll(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      scroll(-1);
    }
  };
  const single = venues.length === 1;
  const item = single
    ? 'w-full md:w-[calc(50%-0.625rem)]'
    : 'w-[85%] sm:w-[60%] md:w-[calc(50%-0.625rem)] xl:w-[calc(33.333%-0.84rem)]';
  const arrow = 'absolute top-[35%] z-10 hidden size-11 -translate-y-1/2 place-items-center rounded-full border-2 border-line-strong bg-surface text-xl font-black text-content-strong shadow-soft hover:bg-surface-hover md:grid';
  return (
    <div className="relative min-w-0" data-testid="venue-carousel">
      <div
        ref={track}
        role="region"
        aria-label="Venues (scroll sideways for more)"
        tabIndex={0}
        onScroll={update}
        onKeyDown={onKeyDown}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-5 overflow-x-auto px-4 pb-4 pt-2 [scrollbar-width:none] focus-visible:outline focus-visible:outline-2 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-8 lg:scroll-px-8 lg:px-8 [&::-webkit-scrollbar]:hidden"
      >
        {venues.map((venue) => (
          <div key={venue.slug} className={`shrink-0 snap-start ${item}`}>
            <VenueCard venue={venue} search={search} />
          </div>
        ))}
      </div>
      {!edges.start && <button type="button" aria-label="Previous venues" onClick={() => scroll(-1)} className={`${arrow} -left-3`}>‹</button>}
      {!edges.end && <button type="button" aria-label="Next venues" onClick={() => scroll(1)} className={`${arrow} -right-3`}>›</button>}
    </div>
  );
}
