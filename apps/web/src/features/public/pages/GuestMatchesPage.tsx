import { MATCH_FORMATS, type MatchFormat } from '@footy-finder/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FormError } from '@/components/ui/FormError.js';
import { FORMAT_LABELS } from '@/features/social/recruitment-labels.js';
import { formatCurrency } from '@/utils/format-currency.js';
import { formatDate } from '@/utils/format-date.js';
import { SignUpPrompt } from '../components/SignUpPrompt.js';
import { usePublicMatches } from '../hooks/usePublic.js';

/**
 * Gate 9 / TKT-910: upcoming public matches for visitors without an account: venue, time, format,
 * the R80 fee and places left. Names are never shown before a match is played.
 */
export function GuestMatchesPage({ home = false }: { home?: boolean }) {
  const [format, setFormat] = useState<MatchFormat | ''>('');
  const matches = usePublicMatches(format || undefined);
  return (
    <section className="grid gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="anime-kicker">{home ? 'FootyFinder' : 'Matches'}</p>
          <h1 className="mt-3 text-4xl font-black uppercase leading-none text-content-strong">{home ? 'Find a game in your city' : 'Upcoming matches'}</h1>
          <p className="mt-2 text-content-muted">Every match is R80 a player, with a FootyFinder referee. Browse freely; sign up when you want to play.</p>
        </div>
        <select aria-label="Format" className="min-h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm font-bold" value={format} onChange={(event) => setFormat(event.target.value as MatchFormat | '')}>
          <option value="">Any format</option>
          {MATCH_FORMATS.map((item) => <option key={item} value={item}>{FORMAT_LABELS[item]}</option>)}
        </select>
      </header>
      <SignUpPrompt action="join a match" />
      <FormError message={matches.error?.message} />
      {matches.data?.length === 0 && <p className="rounded-2xl border border-dashed border-line-strong bg-surface p-8 text-center text-content-muted">No upcoming public matches right now.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {matches.data?.map((match) => (
          <Link key={match.slug} to={`/m/${match.slug}`} className="grid gap-2 rounded-2xl border border-line bg-surface p-5 shadow-sm hover:bg-surface-hover" data-testid="public-match-card">
            <p className="text-xs font-black uppercase tracking-[0.1em] text-brand-700">{FORMAT_LABELS[match.format]} · {formatCurrency(match.feeCents)}</p>
            <p className="font-black text-content-strong">{match.name}</p>
            <p className="text-sm text-content-muted">{match.venue.name}, {match.venue.city}</p>
            <p className="text-sm text-content-muted">{formatDate(match.startsAt)}</p>
            <p className="text-sm font-bold text-content-strong">
              {Math.max(0, match.capacity.total - match.capacity.filled)} of {match.capacity.total} places left
            </p>
            {match.teamMatch && <p className="text-xs text-content-muted">Team match: {match.teamMatch.homeTeamName}{match.teamMatch.awayTeamName ? ` v ${match.teamMatch.awayTeamName}` : ''}</p>}
          </Link>
        ))}
      </div>
      {home && (
        <p className="text-sm text-content-muted">
          Looking for a team? See who's recruiting on the <Link className="font-bold underline" to="/social?tab=teams">recruitment board</Link>.
        </p>
      )}
    </section>
  );
}
