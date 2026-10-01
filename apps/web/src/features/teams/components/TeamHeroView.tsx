import { MATCH_FORMAT_CONFIG, type MatchFormat } from '@footy-finder/shared';
import type { ReactNode } from 'react';
import { TeamAvatar } from './TeamAvatar.js';

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
            {team.locationText || 'Location not set'} · {MATCH_FORMAT_CONFIG[team.primaryFormat].label} · {memberCount} members
          </p>
        </div>
        {badge}
        {action}
      </div>
    </header>
  );
}

/** The section tabs under the team header. */
export function TeamTabs<T extends string>({ tabs, current, onChange }: { tabs: readonly T[]; current: T; onChange: (tab: T) => void }) {
  return (
    <nav className="flex gap-1 overflow-x-auto rounded-xl bg-surface-muted p-1" aria-label="Team sections">
      {tabs.map((item) => (
        <button
          key={item}
          onClick={() => onChange(item)}
          className={`min-h-10 whitespace-nowrap rounded-lg px-4 text-sm font-bold capitalize ${current === item ? 'bg-surface text-brand-700 shadow-sm' : 'text-content-muted'}`}
        >
          {item}
        </button>
      ))}
    </nav>
  );
}
