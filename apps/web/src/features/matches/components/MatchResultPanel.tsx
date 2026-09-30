import type { Match } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { matchClient } from '@/api/client.js';
import { FormError } from '@/components/ui/FormError.js';
import { ResultEntryForm } from '@/features/referee/components/ResultEntryForm.js';
import { matchKey } from '../hooks/useMatches.js';

const resultContextKey = (matchId: string) => [...matchKey(matchId), 'result-context'] as const;
const at = (iso: string) =>
  new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

export const matchSideNames = (match: Pick<Match, 'mode' | 'teamSides'>) => ({
  HOME: match.teamSides.find(({ side }) => side === 'HOME')?.teamNameSnapshot ?? 'Team A',
  AWAY: match.teamSides.find(({ side }) => side === 'AWAY')?.teamNameSnapshot ?? (match.mode === 'TEAM_MATCH' ? 'Individual players' : 'Team B'),
});

/**
 * Gate 8 / TKT-806 (DEC-020) on the match page of a refereed match: the referee's final result
 * (D5), a captain's or host's optional own version (D10, D11, evidence only) and "Report a problem"
 * within 24 hours (D6). There is no dispute button: results are final (D21).
 */
export function MatchResultPanel({ match }: { match: Match }) {
  const cache = useQueryClient();
  const started = ['IN_PROGRESS', 'AWAITING_RESULT', 'COMPLETED'].includes(match.status);
  const context = useQuery({
    queryKey: resultContextKey(match.id),
    queryFn: async () => (await matchClient.resultContext(match.id)).data,
    enabled: Boolean(match.goNoGoAt) && started,
  });
  const refresh = () => void cache.invalidateQueries({ queryKey: resultContextKey(match.id) });
  const [versionOpen, setVersionOpen] = useState(false);
  const version = useMutation({
    mutationFn: (input: Parameters<typeof matchClient.submitResultVersion>[1]) => matchClient.submitResultVersion(match.id, input),
    onSuccess: refresh,
  });
  const [problem, setProblem] = useState('');
  const report = useMutation({
    mutationFn: () => matchClient.reportResultProblem(match.id, { message: problem }),
    onSuccess: () => {
      setProblem('');
      refresh();
    },
  });
  if (!match.goNoGoAt || !started) return null;
  const sides = matchSideNames(match);
  const result = match.result && match.result.finalSource !== 'LEGACY' ? match.result : null;
  const ctx = context.data;
  const submitReport = (event: FormEvent) => {
    event.preventDefault();
    report.mutate();
  };

  return (
    <section className="grid gap-4" aria-label="Match result">
      {result ? (
        <div role="status" data-testid="final-result" className="rounded-3xl border border-brand-200 bg-brand-50 p-6 text-center">
          <p className="text-sm font-black uppercase tracking-widest text-brand-700">Final result</p>
          <p className="mt-3 text-4xl font-black text-content-strong">
            {result.outcomeType === 'FORFEIT'
              ? `${result.forfeitWinner ? sides[result.forfeitWinner] : ''} win by forfeit`
              : result.outcomeType === 'ABANDONED'
                ? 'Abandoned'
                : `${sides.HOME} ${result.homeScore} - ${result.awayScore} ${sides.AWAY}`}
          </p>
          <ul className="mt-4 text-sm text-content">
            {result.goals?.map((goal, index) => (
              <li key={index}>
                {sides[goal.side]}: {goal.ownGoal ? 'own goal' : goal.scorer?.displayName}
                {goal.assist ? ` (assist ${goal.assist.displayName})` : ''}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-content-muted">
            {result.finalSource === 'ADMIN'
              ? 'Recorded by FootyFinder.'
              : `Recorded by the FootyFinder referee${ctx?.referee ? `, ${ctx.referee.displayName}` : ''}.`}{' '}
            The referee&apos;s result is final.
          </p>
        </div>
      ) : (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-content">
          The FootyFinder referee records the final result after the match.
        </p>
      )}

      {ctx?.mySubmission && (
        <p className="text-sm text-content-muted" data-testid="my-result-version">
          You sent your version on {at(ctx.mySubmission.createdAt)}: {sides.HOME} {ctx.mySubmission.homeScore} - {ctx.mySubmission.awayScore} {sides.AWAY}.
        </p>
      )}
      {ctx?.canSubmitVersion && (
        versionOpen ? (
          <ResultEntryForm
            sides={sides}
            lineup={ctx.lineup}
            mode="captain"
            onSubmit={({ didNotPlayUserIds: _ignored, ...input }) => version.mutate(input)}
            pending={version.isPending}
            submitted={version.isSuccess}
            error={version.error?.message}
          />
        ) : (
          <button type="button" className="button-secondary justify-self-start" onClick={() => setVersionOpen(true)}>
            Send your version (optional)
          </button>
        )
      )}

      {ctx?.canReportProblem && (
        <form className="grid gap-2 rounded-2xl border border-line bg-surface p-4" onSubmit={submitReport}>
          <label className="grid gap-1 text-sm font-bold text-content-strong">
            Report a problem with the result
            <textarea
              value={problem}
              onChange={(event) => setProblem(event.target.value)}
              minLength={10}
              maxLength={2000}
              required
              className="min-h-24 rounded-xl border-2 border-line bg-surface p-3 text-sm font-normal text-content"
            />
          </label>
          <p className="text-xs text-content-muted">
            FootyFinder reviews reports sent within 24 hours{ctx.reportProblemUntil ? ` (until ${at(ctx.reportProblemUntil)})` : ''}. Only a clear recording error can be corrected.
          </p>
          <button className="button justify-self-start" disabled={report.isPending}>Send report</button>
          <FormError message={report.error?.message} />
        </form>
      )}
      {ctx?.myReports.map((item) => (
        <p key={item.id} className="rounded-xl border border-line bg-surface p-3 text-sm text-content">
          Your report ({item.status === 'OPEN' ? 'being reviewed' : 'resolved'}): {item.message}
          {item.resolutionNote && <span className="block font-semibold">FootyFinder: {item.resolutionNote}</span>}
        </p>
      ))}
    </section>
  );
}
