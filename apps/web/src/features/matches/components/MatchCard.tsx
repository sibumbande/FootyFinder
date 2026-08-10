import type { Match } from '@footy-finder/shared';
import { Link } from 'react-router-dom';
import { formatDate } from '@/utils/format-date.js';

export function MatchCard({ match }: { match: Match }) {
  return <article className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft"><div className="flex items-start justify-between gap-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${match.status === 'FULL' ? 'bg-danger-50 text-danger-700' : 'bg-brand-50 text-brand-700'}`}>{match.status === 'FULL' ? 'Full' : 'Open lobby'}</span><span className="text-sm font-bold text-content-muted">{match.participantCount}/{match.maxPlayers}</span></div><h2 className="mt-4 text-xl font-bold text-content-strong">{match.name}</h2><p className="mt-2 text-sm font-semibold text-brand-700">{match.venueName}</p><p className="mt-1 text-sm text-content-muted">{formatDate(match.startsAt)}</p><div className="mt-auto pt-5"><Link className="button w-full" to={`/matches/${match.id}`}>View lobby</Link></div></article>;
}
