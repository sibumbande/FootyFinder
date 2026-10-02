import type { TeamStats } from '@footy-finder/shared';
import { useState } from 'react';

const OUTCOME_STYLE: Record<'W' | 'D' | 'L', string> = {
  W: 'bg-success-600 text-content-inverse',
  D: 'bg-surface-muted text-content-strong ring-1 ring-line-strong',
  L: 'bg-danger-600 text-content-inverse',
};
const OUTCOME_WORD = { W: 'Win', D: 'Draw', L: 'Loss' } as const;

/**
 * CEO touch-up batch 4, item 2: a team's statistics from final results only (the same rules as player statistics;
 * a forfeit is a win or a loss with no goals) and its last five results. Members and guests see the same numbers.
 */
export function TeamStatsPanel({ stats }: { stats: TeamStats }) {
  const [open, setOpen] = useState<string>();
  const difference = stats.goalDifference > 0 ? `+${stats.goalDifference}` : String(stats.goalDifference);
  const cells: Array<[string, string, string]> = [
    ['Played', 'P', String(stats.played)],
    ['Won', 'W', String(stats.wins)],
    ['Drawn', 'D', String(stats.draws)],
    ['Lost', 'L', String(stats.losses)],
    ['Goals for', 'GF', String(stats.goalsFor)],
    ['Goals against', 'GA', String(stats.goalsAgainst)],
    ['Goal difference', 'GD', difference],
  ];
  const shown = stats.lastFive.find(({ matchId }) => matchId === open);
  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="team-stats-heading" data-testid="team-stats">
      <h2 id="team-stats-heading" className="text-xl font-bold text-content-strong">Results</h2>
      <dl className="grid grid-cols-4 gap-2 text-center sm:grid-cols-7">
        {cells.map(([label, short, value]) => (
          <div key={label} className="min-w-0 rounded-2xl bg-surface-muted p-2 sm:p-3" title={label}>
            <dt className="text-[10px] font-black uppercase text-content-muted"><abbr title={label} className="no-underline">{short}</abbr><span className="sr-only">{label}</span></dt>
            <dd className="text-xl font-black text-content-strong sm:text-2xl">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-black uppercase tracking-[0.08em] text-content-muted">Last 5</span>
        {stats.lastFive.length === 0 && <span className="text-sm text-content-muted">No final results yet.</span>}
        {stats.lastFive.map((entry) => (
          <button
            key={entry.matchId}
            type="button"
            onClick={() => setOpen((current) => (current === entry.matchId ? undefined : entry.matchId))}
            aria-pressed={open === entry.matchId}
            title={`${OUTCOME_WORD[entry.outcome]} v ${entry.opponent}${entry.forfeit ? ' (forfeit)' : ` ${entry.goalsFor}-${entry.goalsAgainst}`}`}
            className={`grid size-9 place-items-center rounded-full text-sm font-black ${OUTCOME_STYLE[entry.outcome]}`}
            data-testid="team-form-chip"
          >
            {entry.outcome}
            <span className="sr-only"> ({OUTCOME_WORD[entry.outcome]} v {entry.opponent})</span>
          </button>
        ))}
      </div>
      {shown && (
        <p className="break-words text-sm text-content" role="status">
          {OUTCOME_WORD[shown.outcome]} v {shown.opponent}: {shown.forfeit ? 'forfeit' : `${shown.goalsFor}-${shown.goalsAgainst}`} · {new Date(shown.startsAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
        </p>
      )}
      <p className="text-xs text-content-muted">Only final results recorded by FootyFinder count. A forfeit counts as a win or a loss with no goals.</p>
    </section>
  );
}
