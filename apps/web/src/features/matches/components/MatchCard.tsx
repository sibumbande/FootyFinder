import { getMaxMatchParticipants, MATCH_FORMAT_CONFIG, type Match } from '@footy-finder/shared';
import { Link } from 'react-router-dom';
import { formatCurrency } from '@/utils/format-currency.js';
import { formatDate } from '@/utils/format-date.js';
export function MatchCard({ match }: { match: Match }) {
  const capacity = getMaxMatchParticipants(match.format, match.substituteCapacityPerTeam);
  return (
    <article className="anime-panel flex h-full flex-col p-5 transition hover:-translate-y-1 hover:border-brand-500">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <span className="score-chip bg-brand-600 text-content-inverse">
            {MATCH_FORMAT_CONFIG[match.format].shortLabel}
          </span>
          <span className="score-chip bg-surface-muted text-content-muted">
            {match.status.replace('_', ' ').toLowerCase()}
          </span>
          <span className="score-chip bg-warning-50 text-warning-700">
            +{match.substituteCapacityPerTeam} subs/team
          </span>
        </div>
        <span className="text-sm font-bold text-content-muted">
          {match.participantCount}/{capacity}
        </span>
      </div>
      <h2 className="mt-4 text-2xl font-bold uppercase leading-tight text-content-strong">
        {match.name}
      </h2>
      <p className="mt-2 text-sm font-semibold text-brand-700">{match.venue.name}</p>
      <p className="mt-1 text-sm text-content-muted">
        {match.venue.city} · {formatDate(match.startsAt)}
      </p>
      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="font-bold text-content-strong">
          {match.feeCents === 0 ? 'Free' : formatCurrency(match.feeCents, match.currency)}
        </span>
      </div>
      <div className="mt-auto pt-5">
        <Link className="button w-full" to={`/matches/${match.id}`}>
          View match
        </Link>
      </div>
    </article>
  );
}
