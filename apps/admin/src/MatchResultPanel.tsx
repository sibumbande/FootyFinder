import {
  MATCH_RESULT_PROBLEM_MESSAGES,
  validateMatchResult,
  type AdminResultDetail,
  type AdminResultQueueItem,
  type MatchLineupPlayer,
  type RefereeResultInput,
} from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { adminClient } from './api.js';
import { AdminActionError } from './FreshMfa.js';
import { matchesKey, when } from './MatchActions.js';

const rootKey = matchesKey;

const scoreLine = (item: Pick<AdminResultQueueItem, 'sides'>, result: { outcomeType: string; homeScore: number; awayScore: number; forfeitWinner: 'HOME' | 'AWAY' | null }) =>
  result.outcomeType === 'FORFEIT'
    ? `${result.forfeitWinner ? item.sides[result.forfeitWinner] : '?'} win by forfeit`
    : result.outcomeType === 'ABANDONED'
      ? 'Abandoned'
      : `${item.sides.HOME} ${result.homeScore} - ${result.awayScore} ${item.sides.AWAY}`;

/**
 * Gate 8 / TKT-807 (DEC-020), on the match page since CEO touch-up batch 3.5, item 5: the final result, the captains' versions
 * (evidence only), entering a result the referee did not record (D3) or correcting a clear recording error (D5), the
 * history and the problem reports (D6). Entering and correcting need a fresh authenticator check (unchanged).
 */
export function MatchResultPanel({ matchId }: { matchId: string }) {
  const detail = useQuery({ queryKey: [...rootKey, 'detail', matchId], queryFn: async () => (await adminClient.resultDetail(matchId)).data });
  if (detail.error) return <p className="error">{detail.error.message}</p>;
  if (!detail.data) return <p className="muted">Loading…</p>;
  const item = detail.data;
  const canEnter = !item.result && ['IN_PROGRESS', 'AWAITING_RESULT'].includes(item.status);
  return (
    <div className="stack" data-testid="result-panel">
      <h3>Result: {item.sides.HOME} v {item.sides.AWAY}</h3>
      <p>
        Referee: {item.referee?.displayName ?? 'none'}
        {item.refereeAlsoPlayed && <strong> · Referee also played (for the record)</strong>}
      </p>
      {item.overdue && <p className="error">The referee has not recorded the result within 2 hours of the end.</p>}
      <h4>Final result</h4>
      {item.result ? (
        <>
          <p><strong>{scoreLine(item, item.result)}</strong> · {item.result.finalSource === 'REFEREE' ? 'recorded by the referee' : 'recorded by an admin'}</p>
          <ul>
            {item.result.goals.map((goal, index) => (
              <li key={index}>{item.sides[goal.side]}: {goal.ownGoal ? 'own goal' : goal.scorer?.displayName}{goal.assist ? ` (assist ${goal.assist.displayName})` : ''}</li>
            ))}
          </ul>
        </>
      ) : <p className="muted">No result yet.</p>}
      <h4>Captains' versions (evidence only)</h4>
      {item.captainVersions.length === 0 && <p className="muted">None sent.</p>}
      <ul>
        {item.captainVersions.map((version) => (
          <li key={version.id} className={version.mismatch ? 'error' : undefined}>
            {version.submittedBy.displayName}{version.side ? ` (${item.sides[version.side]})` : ' (host)'}: {scoreLine(item, version)}
            {version.goals.length > 0 && ` · ${version.goals.map((goal) => `${item.sides[goal.side]}: ${goal.ownGoal ? 'own goal' : item.lineup.find((player) => player.userId === goal.scorerUserId)?.displayName ?? 'unknown scorer'}`).join('; ')}`}
            {version.mismatch && ' · MISMATCH'} · {when(version.createdAt)}
          </li>
        ))}
      </ul>
      {(canEnter || item.result) && <AdminResultForm detail={item} mode={item.result ? 'correction' : 'entry'} />}
      <h4>History</h4>
      <ul>
        {item.revisions.map((revision) => (
          <li key={revision.revisionNumber}>
            #{revision.revisionNumber} {revision.reason.replaceAll('_', ' ').toLowerCase()} by {revision.createdBy?.displayName ?? 'unknown'} · {revision.outcomeType ?? 'PLAYED'} {revision.homeScore}-{revision.awayScore} · {when(revision.createdAt)}
            {revision.correctionReason && ` · reason: ${revision.correctionReason}`}
          </li>
        ))}
      </ul>
      {item.problems.length > 0 && (
        <>
          <h4>Problem reports</h4>
          {item.problems.map((problem) => <ProblemCard key={problem.id} problem={problem} />)}
        </>
      )}
    </div>
  );
}

type GoalRow = { side: 'HOME' | 'AWAY'; scorerUserId: string; assistUserId: string; ownGoal: boolean };

function AdminResultForm({ detail, mode }: { detail: AdminResultDetail; mode: 'entry' | 'correction' }) {
  const cache = useQueryClient();
  const [outcome, setOutcome] = useState<RefereeResultInput['outcome']>(detail.result?.outcomeType ?? 'PLAYED');
  const [forfeitWinner, setForfeitWinner] = useState<'HOME' | 'AWAY' | ''>(detail.result?.forfeitWinner ?? '');
  const [goals, setGoals] = useState<GoalRow[]>(
    detail.result?.goals.map((goal) => ({ side: goal.side, ownGoal: goal.ownGoal, scorerUserId: goal.scorer?.userId ?? '', assistUserId: goal.assist?.userId ?? '' })) ?? [],
  );
  const [didNotPlay, setDidNotPlay] = useState<string[]>(detail.lineup.filter((player) => player.didNotPlay).map(({ userId }) => userId));
  const [reason, setReason] = useState('');
  const played = outcome === 'PLAYED';
  const input: RefereeResultInput = {
    outcome,
    homeScore: played ? goals.filter((goal) => goal.side === 'HOME').length : 0,
    awayScore: played ? goals.filter((goal) => goal.side === 'AWAY').length : 0,
    ...(outcome === 'FORFEIT' && forfeitWinner ? { forfeitWinner } : {}),
    goals: played
      ? goals.map((goal) => goal.ownGoal
        ? { side: goal.side, ownGoal: true }
        : { side: goal.side, ownGoal: false, ...(goal.scorerUserId ? { scorerUserId: goal.scorerUserId } : {}), ...(goal.assistUserId ? { assistUserId: goal.assistUserId } : {}) })
      : [],
    didNotPlayUserIds: didNotPlay,
  };
  const problems = validateMatchResult(input, detail.lineup).map((problem) => MATCH_RESULT_PROBLEM_MESSAGES[problem]);
  const save = useMutation({
    mutationFn: () => (mode === 'entry' ? adminClient.enterResult : adminClient.correctResult)(detail.matchId, { result: input, reason }),
    onSuccess: ({ data }) => {
      cache.setQueryData([...rootKey, 'detail', detail.matchId], data);
      void cache.invalidateQueries({ queryKey: rootKey });
      setReason('');
    },
  });
  const players = (side: 'HOME' | 'AWAY') => detail.lineup.filter((player: MatchLineupPlayer) => player.side === side && !didNotPlay.includes(player.userId));
  const update = (index: number, patch: Partial<GoalRow>) => setGoals(goals.map((goal, position) => (position === index ? { ...goal, ...patch } : goal)));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <form className="stack" onSubmit={submit}>
      <h4>{mode === 'entry' ? 'Enter the result (referee did not record it)' : 'Correct a clear recording error'}</h4>
      <label>Outcome
        <select value={outcome} onChange={(event) => setOutcome(event.target.value as RefereeResultInput['outcome'])}>
          <option value="PLAYED">Played</option><option value="FORFEIT">Forfeit</option><option value="ABANDONED">Abandoned</option>
        </select>
      </label>
      {outcome === 'FORFEIT' && (
        <label>Forfeit winner
          <select value={forfeitWinner} onChange={(event) => setForfeitWinner(event.target.value as 'HOME' | 'AWAY' | '')}>
            <option value="">Choose</option><option value="HOME">{detail.sides.HOME}</option><option value="AWAY">{detail.sides.AWAY}</option>
          </select>
        </label>
      )}
      {played && (
        <>
          <p><strong>{detail.sides.HOME} {input.homeScore} - {input.awayScore} {detail.sides.AWAY}</strong></p>
          {goals.map((goal, index) => (
            <div key={index} className="row">
              <select aria-label={`Goal ${index + 1} team`} value={goal.side} onChange={(event) => update(index, { side: event.target.value as 'HOME' | 'AWAY', scorerUserId: '', assistUserId: '' })}>
                <option value="HOME">{detail.sides.HOME}</option><option value="AWAY">{detail.sides.AWAY}</option>
              </select>
              <select aria-label={`Goal ${index + 1} scorer`} value={goal.ownGoal ? '__own' : goal.scorerUserId} onChange={(event) => update(index, event.target.value === '__own' ? { ownGoal: true, scorerUserId: '', assistUserId: '' } : { ownGoal: false, scorerUserId: event.target.value })}>
                <option value="">Scorer</option>
                {players(goal.side).map((player) => <option key={player.userId} value={player.userId}>{player.displayName}</option>)}
                <option value="__own">Own goal by an opponent</option>
              </select>
              {!goal.ownGoal && (
                <select aria-label={`Goal ${index + 1} assist`} value={goal.assistUserId} onChange={(event) => update(index, { assistUserId: event.target.value })}>
                  <option value="">No assist</option>
                  {players(goal.side).filter((player) => player.userId !== goal.scorerUserId).map((player) => <option key={player.userId} value={player.userId}>{player.displayName}</option>)}
                </select>
              )}
              <button type="button" className="ghost" onClick={() => setGoals(goals.filter((_, position) => position !== index))}>Remove</button>
            </div>
          ))}
          <div className="row">
            <button type="button" className="ghost" onClick={() => setGoals([...goals, { side: 'HOME', ownGoal: false, scorerUserId: '', assistUserId: '' }])}>Add {detail.sides.HOME} goal</button>
            <button type="button" className="ghost" onClick={() => setGoals([...goals, { side: 'AWAY', ownGoal: false, scorerUserId: '', assistUserId: '' }])}>Add {detail.sides.AWAY} goal</button>
          </div>
        </>
      )}
      <fieldset>
        <legend>Did not play</legend>
        {detail.lineup.map((player) => (
          <label key={player.userId}>
            <input type="checkbox" checked={didNotPlay.includes(player.userId)} onChange={() => setDidNotPlay(didNotPlay.includes(player.userId) ? didNotPlay.filter((id) => id !== player.userId) : [...didNotPlay, player.userId])} />
            {player.displayName} ({detail.sides[player.side]})
          </label>
        ))}
      </fieldset>
      <label>Reason (recorded in the history and audit log)
        <input value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required />
      </label>
      {problems.map((problem) => <p key={problem} className="error">{problem}</p>)}
      <button disabled={problems.length > 0 || reason.trim().length < 3 || save.isPending}>{mode === 'entry' ? 'Enter final result' : 'Save correction'}</button>
      <AdminActionError error={save.error} onVerified={() => save.reset()} />
    </form>
  );
}

function ProblemCard({ problem }: { problem: AdminResultDetail['problems'][number] }) {
  const cache = useQueryClient();
  const [note, setNote] = useState('');
  const resolve = useMutation({
    mutationFn: () => adminClient.resolveResultProblem(problem.id, note),
    onSuccess: () => void cache.invalidateQueries({ queryKey: rootKey }),
  });
  return (
    <div className="support-message">
      <strong>{problem.reporter.displayName}{problem.side ? ` (${problem.side.toLowerCase()} side)` : ' (host)'} · {problem.matchName}</strong>
      <p>{problem.message}</p>
      <small>{when(problem.createdAt)} · {problem.status}{problem.resolutionNote ? ` · ${problem.resolvedBy?.displayName}: ${problem.resolutionNote}` : ''}</small>
      {problem.status === 'OPEN' && (
        <div className="row">
          <input aria-label="Resolution note" placeholder="Note for the reporter" value={note} onChange={(event) => setNote(event.target.value)} />
          <button type="button" disabled={note.trim().length < 3 || resolve.isPending} onClick={() => resolve.mutate()}>Resolve</button>
        </div>
      )}
      <AdminActionError error={resolve.error} />
    </div>
  );
}

