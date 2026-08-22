import { getMaxMatchParticipants, MATCH_FORMAT_CONFIG, type Match } from '@footy-finder/shared';
import { Link } from 'react-router-dom';
import { formatCurrency } from '@/utils/format-currency.js';
import { formatDate } from '@/utils/format-date.js';
export function MatchCard({ match }: { match: Match }) {
  const capacity = getMaxMatchParticipants(match.format, match.substituteCapacityPerTeam);
  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700">
            {MATCH_FORMAT_CONFIG[match.format].shortLabel}
          </span>
          <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-bold text-content-muted">
            {match.status.replace('_', ' ').toLowerCase()}
          </span>
          <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-bold text-content-muted">
            +{match.substituteCapacityPerTeam} subs/team
          </span>
        </div>
        <span className="text-sm font-bold text-content-muted">
          {match.participantCount}/{capacity}
        </span>
      </div>
      <h2 className="mt-4 text-xl font-bold text-content-strong">{match.name}</h2>
      <p className="mt-2 text-sm font-semibold text-brand-700">{match.venue.name}</p>
      <p className="mt-1 text-sm text-content-muted">
        {match.venue.city} · {formatDate(match.startsAt)}
      </p>
      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="font-bold text-content-strong">
          {match.feeCents === 0 ? 'Free' : formatCurrency(match.feeCents, match.currency)}
        </span>
        {match.distanceKm !== undefined && (
          <span className="text-content-muted">{match.distanceKm.toFixed(1)} km away</span>
        )}
      </div>
      <div className="mt-auto pt-5">
        <Link className="button w-full" to={`/matches/${match.id}`}>
          View match
        </Link>
      </div>
    </article>
  );
}
