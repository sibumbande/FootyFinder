import { MATCH_FORMAT_CONFIG, type MatchFormat } from '@footy-finder/shared';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { TeamAvatar } from './TeamAvatar.js';
import { plural } from '@/utils/plural.js';

type HeroTeam = {
  name: string;
  shortName?: string | null;
  profileImageUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  locationText?: string | null;
  primaryFormat: MatchFormat;
};

/** CEO touch-up batch 2, item 5: the team header members and guests both see. */
export function TeamHeroView({ team, memberCount, badge, action }: { team: HeroTeam; memberCount: number; badge?: ReactNode; action?: ReactNode }) {
  return (
    <header className="overflow-hidden rounded-3xl border border-line bg-surface shadow-soft">
      <div
        className="h-24 sm:h-32"
        style={{
          background: `linear-gradient(120deg, ${team.primaryColor ?? 'rgb(var(--theme-brand-600))'}, ${team.secondaryColor ?? 'rgb(var(--theme-brand-900))'})`,
        }}
      />
      <div className="flex flex-col gap-4 p-6 sm:-mt-12 sm:flex-row sm:items-end">
        <TeamAvatar team={team} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-black text-content-strong [overflow-wrap:anywhere]">{team.name}</h1>
            {team.shortName && (
              <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">
                {team.shortName}
              </span>
            )}
          </div>
          <p className="mt-2 text-content-muted">
            {team.locationText || 'Location not set'} · {MATCH_FORMAT_CONFIG[team.primaryFormat].label} · {plural(memberCount, 'member')}
          </p>
        </div>
        {badge}
        {action}
      </div>
    </header>
  );
}

/**
 * The section tabs under the team header. CEO touch-up batch 3, item 10: 44 px tall labels that are easy to tap,
 * a fade on the edge where more tabs are hidden, a small arrow that scrolls to the next tabs, and the active tab
 * always scrolled into view.
 */
export function TeamTabs<T extends string>({ tabs, current, onChange }: { tabs: readonly T[]; current: T; onChange: (tab: T) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const update = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    setEdges({ start: element.scrollLeft <= 4, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [update, tabs.length]);
  useEffect(() => {
    // Scroll only the tab strip (never the page) so the active tab is in view.
    const element = scroller.current;
    const active = element?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (element && active) element.scrollLeft = Math.max(0, active.offsetLeft - (element.clientWidth - active.offsetWidth) / 2);
    update();
  }, [current, update]);
  const next = () => scroller.current?.scrollBy({ left: scroller.current.clientWidth * 0.6, behavior: 'smooth' });
  return (
    <nav className="relative min-w-0" aria-label="Team sections">
      <div
        ref={scroller}
        role="tablist"
        onScroll={update}
        className="relative flex gap-1 overflow-x-auto rounded-xl bg-surface-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={current === item}
            onClick={() => onChange(item)}
            className={`min-h-11 shrink-0 whitespace-nowrap rounded-lg px-4 text-base font-bold capitalize ${current === item ? 'bg-surface text-brand-700 shadow-sm' : 'text-content-muted hover:text-content-strong'}`}
          >
            {item}
          </button>
        ))}
      </div>
      {!edges.start && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-8 rounded-l-xl bg-gradient-to-r from-surface-muted to-transparent" />}
      {!edges.end && (
        <>
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-20 rounded-r-xl bg-gradient-to-l from-surface-muted via-surface-muted/80 to-transparent" />
          <button
            type="button"
            aria-label="Show more team sections"
            onClick={next}
            className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg border border-line bg-surface text-xl font-black text-content-strong shadow-sm"
          >
            ›
          </button>
        </>
      )}
    </nav>
  );
}
