import type { PublicMatchResult } from '@footy-finder/shared';

/** Gate 9 / TKT-910: a played match's final result with scorers, shown to everyone. */
export function PublicResult({ result }: { result: PublicMatchResult }) {
  const goals = (side: 'HOME' | 'AWAY') => result.goals.filter((goal) => goal.side === side);
  return (
    <section className="rounded-3xl border border-line bg-surface p-6 shadow-sm sm:p-8" data-testid="public-result">
      <p className="anime-kicker">Final result</p>
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-center">
        <p className="text-lg font-black text-content-strong">{result.homeName}</p>
        <p className="text-4xl font-black text-content-strong">
          {result.outcome === 'ABANDONED' ? 'Abandoned' : `${result.homeScore} - ${result.awayScore}`}
        </p>
        <p className="text-lg font-black text-content-strong">{result.awayName}</p>
      </div>
      {result.outcome === 'FORFEIT' && (
        <p className="mt-2 text-center text-sm text-content-muted">Won by forfeit: {result.forfeitWinner === 'HOME' ? result.homeName : result.awayName}</p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        {(['HOME', 'AWAY'] as const).map((side) => (
          <ul key={side} className={`grid gap-1 ${side === 'AWAY' ? 'text-right' : ''}`}>
            {goals(side).map((goal, index) => (
              <li key={index} className="text-content">
                ⚽ {goal.ownGoal ? 'Own goal' : goal.scorer ?? 'Goal'}
                {goal.assister && <span className="text-content-muted"> (assist {goal.assister})</span>}
              </li>
            ))}
          </ul>
        ))}
      </div>
    </section>
  );
}
