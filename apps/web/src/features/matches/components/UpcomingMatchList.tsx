import { getMaxMatchParticipants, MATCH_FORMAT_CONFIG, type Match, type MatchFormat, type PublicMatchPreview } from '@footy-finder/shared';
import { Link } from 'react-router-dom';
import { formatCurrency } from '@/utils/format-currency.js';
import { FreeMatchBadge } from './FreeMatchBadge.js';
import { plural } from '@/utils/plural.js';

type Row = {
  key: string;
  href: string;
  name: string;
  venueName: string;
  startsAt: string;
  format: MatchFormat;
  placesLeft: number;
  feeCents: number;
  free: boolean;
  firstTimersOnly: boolean;
};

const day = (iso: string) => new Intl.DateTimeFormat('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Johannesburg' }).format(new Date(iso));
const time = (iso: string) => new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Johannesburg' }).format(new Date(iso));

export const memberRow = (match: Match): Row => ({
  key: match.id,
  href: `/matches/${match.id}`,
  name: match.name,
  venueName: match.venue.name,
  startsAt: match.startsAt,
  format: match.format,
  placesLeft: Math.max(0, getMaxMatchParticipants(match.format, match.substituteCapacityPerTeam) - match.participantCount),
  feeCents: match.feeCents,
  free: match.freeOnFootyFinder,
  firstTimersOnly: match.firstTimersOnly,
});

/** Guests see counts only (TKT-910). */
export const guestRow = (match: PublicMatchPreview): Row => ({
  key: match.slug,
  href: `/m/${match.slug}`,
  name: match.name,
  venueName: match.venue.name,
  startsAt: match.startsAt,
  format: match.format,
  placesLeft: Math.max(0, match.capacity.total - match.capacity.filled),
  feeCents: match.feeCents,
  free: match.freeOnFootyFinder,
  firstTimersOnly: match.firstTimersOnly,
});

/** CEO touch-up batch 3, item 8: the soonest joinable matches as a vertical list (members and guests). */
export function UpcomingMatchList({ rows }: { rows: Row[] }) {
  return (
    <ol className="grid gap-3" data-testid="upcoming-matches">
      {rows.map((row) => (
        <li key={row.key}>
          <Link to={row.href} className="flex min-h-[4.5rem] items-center gap-4 rounded-2xl border border-line bg-surface p-3 shadow-sm transition hover:border-brand-500 hover:bg-surface-hover sm:p-4">
            <div className="grid w-16 shrink-0 place-items-center rounded-xl bg-brand-900 px-2 py-2 text-center text-content-inverse">
              <span className="text-[11px] font-bold uppercase leading-tight text-hero-muted">{day(row.startsAt)}</span>
              <span className="text-lg font-black leading-tight">{time(row.startsAt)}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-black leading-snug text-content-strong break-words">{row.name}</p>
              <p className="text-sm text-content-muted break-words">{row.venueName} · {MATCH_FORMAT_CONFIG[row.format].shortLabel}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-bold text-content-strong">{plural(row.placesLeft, 'place left', 'places left')}</span>
                {row.free ? <FreeMatchBadge firstTimersOnly={row.firstTimersOnly} /> : <span className="text-content-muted">{formatCurrency(row.feeCents)}</span>}
              </div>
            </div>
            <span aria-hidden="true" className="text-xl font-black text-content-muted">›</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
