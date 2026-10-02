import type { MatchLineupPlayer, RefereeMatchDetail } from '@footy-finder/shared';
import { Link, useParams } from 'react-router-dom';
import { FormError } from '@/components/ui/FormError.js';
import { RefereeResultForm } from '../components/RefereeResultForm.js';
import { useDeclineRefereeMatch, useRefereeMatch } from '../hooks/useReferee.js';
import { formatKickoff } from '../utils.js';
import { PlayerName } from '@/components/ui/PlayerName.js';

/** Gate 8 / TKT-805 (DEC-020): one match the referee is assigned to: lineups, decline, result. */
export function RefereeMatchPage() {
  const { matchId = '' } = useParams();
  const match = useRefereeMatch(matchId);
  const decline = useDeclineRefereeMatch(matchId);
  if (match.isPending) return <div className="h-40 animate-pulse rounded-2xl bg-surface" />;
  if (!match.data) return <FormError message={match.error?.message ?? 'Match not found.'} />;
  const data = match.data;
  if (decline.isSuccess)
    return (
      <section className="grid gap-4">
        <p role="status" className="font-bold text-content">You declined this match. FootyFinder will find another referee.</p>
        <Link className="button-secondary" to="/referee">Back to your matches</Link>
      </section>
    );
  return (
    <section className="grid gap-5">
      <Link className="text-sm font-bold text-brand-700" to="/referee">Back to your matches</Link>
      <header className="grid gap-1">
        <p className="anime-kicker">Referee</p>
        <h1 className="text-2xl font-black text-content-strong sm:text-3xl">
          {data.sides.HOME} v {data.sides.AWAY}
        </h1>
        <p className="text-content">{data.name}</p>
        <p className="text-sm text-content-muted">
          {formatKickoff(data.startsAt)} · {data.venue.name}, {data.venue.addressLine1}, {data.venue.city}
        </p>
        <p className="text-sm text-content-muted">{data.confirmed ? 'Confirmed: the match goes ahead.' : 'Not confirmed yet: checked 30 minutes before kickoff.'}</p>
      </header>

      {data.result ? (
        <FinalResult match={data} />
      ) : data.canRecordResult ? (
        <RefereeResultForm match={data} />
      ) : (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-content">You can record the result from kickoff.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {(['HOME', 'AWAY'] as const).map((side) => (
          <Lineup key={side} title={data.sides[side]} players={data.lineup.filter((player) => player.side === side)} />
        ))}
      </div>
      {!data.lineupRecorded && <p className="text-xs text-content-muted">Lineups can still change until kickoff.</p>}

      {data.canDecline && (
        <button
          type="button"
          className="justify-self-start text-sm font-bold text-danger-700"
          disabled={decline.isPending}
          onClick={() => {
            const reason = window.prompt('Why can you not referee this match? (optional)') ?? undefined;
            if (window.confirm('Decline this match? FootyFinder will assign another referee.'))
              decline.mutate(reason ? { reason } : {});
          }}
        >
          I can't referee this match
        </button>
      )}
      <FormError message={decline.error?.message} />
    </section>
  );
}

function Lineup({ title, players }: { title: string; players: MatchLineupPlayer[] }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4" data-testid="referee-lineup">
      <h2 className="font-black text-content-strong">{title}</h2>
      {players.length === 0 && <p className="text-sm text-content-muted">No players yet.</p>}
      <ul className="mt-2 grid gap-1 text-sm text-content">
        {players.map((player) => (
          <li key={player.userId} className="flex min-w-0 items-center gap-1">
            <span className="min-w-0"><PlayerName name={player.displayName} revealOnTap /></span>
            {player.role === 'SUBSTITUTE' && <span className="shrink-0 text-content-muted"> (sub)</span>}
            {player.didNotPlay && <span className="shrink-0 text-content-muted"> (did not play)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FinalResult({ match }: { match: RefereeMatchDetail }) {
  const result = match.result!;
  return (
    <section role="status" className="grid gap-2 rounded-2xl border-2 border-brand-200 bg-brand-50 p-4">
      <p className="text-xs font-black uppercase text-brand-700">Final result</p>
      <p className="text-2xl font-black text-content-strong">
        {result.outcomeType === 'PLAYED'
          ? `${match.sides.HOME} ${result.homeScore} - ${result.awayScore} ${match.sides.AWAY}`
          : result.outcomeType === 'FORFEIT'
            ? `${result.forfeitWinner ? match.sides[result.forfeitWinner] : ''} win by forfeit`
            : 'Abandoned: no result counts'}
      </p>
      <ul className="text-sm text-content">
        {result.goals.map((goal, index) => (
          <li key={index}>
            {match.sides[goal.side]}: {goal.ownGoal ? 'own goal' : goal.scorer?.displayName}
            {goal.assist ? ` (assist ${goal.assist.displayName})` : ''}
          </li>
        ))}
      </ul>
      {result.finalSource === 'ADMIN' && <p className="text-xs text-content-muted">Recorded or corrected by FootyFinder.</p>}
    </section>
  );
}
