import type { RefereeMatchSummary } from '@footy-finder/shared';
import { Link } from 'react-router-dom';
import { FormError } from '@/components/ui/FormError.js';
import { useRefereeMatches } from '../hooks/useReferee.js';
import { formatKickoff } from '../utils.js';

/** Gate 8 / TKT-805 (DEC-020): the referee's matches, most urgent first. */
export function RefereePage() {
  const matches = useRefereeMatches();
  const toRecord = matches.data?.filter((match) => match.canRecordResult) ?? [];
  const upcoming = matches.data?.filter((match) => !match.canRecordResult && !match.hasResult) ?? [];
  const finished = matches.data?.filter((match) => match.hasResult) ?? [];
  return (
    <section className="grid gap-6">
      <header>
        <p className="anime-kicker">Referee</p>
        <h1 className="mt-3 text-3xl font-black uppercase leading-none text-content-strong sm:text-4xl">Your matches</h1>
        <p className="mt-2 text-content-muted">
          You referee these matches for FootyFinder. After each match, record the score, scorers and assisters. Your
          result is final.
        </p>
      </header>
      <FormError message={matches.error?.message} />
      {matches.isPending && <div className="h-24 animate-pulse rounded-2xl bg-surface" />}
      {matches.data?.length === 0 && <p className="text-content-muted">You have no matches to referee right now.</p>}
      <MatchGroup title="Record the result" matches={toRecord} urgent />
      <MatchGroup title="Upcoming" matches={upcoming} />
      <MatchGroup title="Finished" matches={finished} />
    </section>
  );
}

function MatchGroup({ title, matches, urgent = false }: { title: string; matches: RefereeMatchSummary[]; urgent?: boolean }) {
  if (!matches.length) return null;
  return (
    <div className="grid gap-3">
      <h2 className="text-lg font-black text-content-strong">{title}</h2>
      {matches.map((match) => (
        <Link
          key={match.matchId}
          to={`/referee/matches/${match.matchId}`}
          data-testid="referee-match-card"
          className={`grid gap-1 rounded-2xl border-2 p-4 ${urgent ? 'border-warning-300 bg-warning-50' : 'border-line bg-surface'}`}
        >
          <span className="font-black text-content-strong">
            {match.sides.HOME} v {match.sides.AWAY}
          </span>
          <span className="text-sm text-content">{match.name}</span>
          <span className="text-sm text-content-muted">
            {formatKickoff(match.startsAt)} · {match.venue.name}, {match.venue.city}
          </span>
          {urgent && <span className="text-sm font-bold text-warning-700">Result needed</span>}
        </Link>
      ))}
    </div>
  );
}
