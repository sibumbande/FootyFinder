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

const rootKey = ['admin', 'results'] as const;
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
type View = 'awaiting' | 'recent' | 'problems' | 'report';

const scoreLine = (item: Pick<AdminResultQueueItem, 'sides'>, result: { outcomeType: string; homeScore: number; awayScore: number; forfeitWinner: 'HOME' | 'AWAY' | null }) =>
  result.outcomeType === 'FORFEIT'
    ? `${result.forfeitWinner ? item.sides[result.forfeitWinner] : '?'} win by forfeit`
    : result.outcomeType === 'ABANDONED'
      ? 'Abandoned'
      : `${item.sides.HOME} ${result.homeScore} - ${result.awayScore} ${item.sides.AWAY}`;

/**
 * Gate 8 / TKT-807 (DEC-020): results operations. The referee's result is final (D5). Admins enter
 * a result when the referee did not (D3, using the captains' versions as evidence), correct a clear
 * recording error with a reason (D5), work the problem-report queue (D6) and run the
 * matches-refereed report (D8, no money). Entering and correcting need a fresh authenticator check.
 */
export function ResultsPage() {
  const [view, setView] = useState<View>('awaiting');
  const [selected, setSelected] = useState<string>();
  return (
    <section>
      <p className="eyebrow">Match officials</p>
      <h2>Results</h2>
      <div className="row">
        {([['awaiting', 'Awaiting result'], ['recent', 'Recent results'], ['problems', 'Problem reports'], ['report', 'Referee report']] as const).map(([key, label]) => (
          <button key={key} className={view === key ? '' : 'ghost'} onClick={() => { setView(key); setSelected(undefined); }}>{label}</button>
        ))}
      </div>
      {(view === 'awaiting' || view === 'recent') && (
        <div className="support-layout">
          <ResultQueue view={view} selected={selected} onSelect={setSelected} />
          <div>{selected ? <ResultDetail matchId={selected} /> : <p className="muted">Choose a match.</p>}</div>
        </div>
      )}
      {view === 'problems' && <ProblemQueue onOpenMatch={(matchId) => { setView('recent'); setSelected(matchId); }} />}
      {view === 'report' && <RefereeReport />}
    </section>
  );
}

function ResultQueue({ view, selected, onSelect }: { view: 'awaiting' | 'recent'; selected?: string; onSelect: (id: string) => void }) {
  const queue = useQuery({ queryKey: [...rootKey, view], queryFn: async () => (await adminClient.resultQueue(view)).data, refetchInterval: 30_000 });
  return (
    <div className="ticket-list">
      {queue.error && <p className="error">{queue.error.message}</p>}
      {queue.data?.length === 0 && <p className="muted">{view === 'awaiting' ? 'No match is waiting for a result.' : 'No results in the last 14 days.'}</p>}
      {queue.data?.map((item) => (
        <button key={item.matchId} className={selected === item.matchId ? 'ticket active-ticket' : 'ticket'} onClick={() => onSelect(item.matchId)}>
          <strong>{item.sides.HOME} v {item.sides.AWAY}</strong>
          <span>{item.name} · {when(item.startsAt)}</span>
          <small>
            {item.result ? scoreLine(item, item.result) : 'No result yet'}
            {item.overdue && ' · OVERDUE'}
            {item.mismatch && ' · Mismatch'}
            {item.refereeAlsoPlayed && ' · Referee also played'}
            {item.openProblemCount > 0 && ` · ${item.openProblemCount} open report(s)`}
          </small>
        </button>
      ))}
    </div>
  );
}

function ResultDetail({ matchId }: { matchId: string }) {
  const detail = useQuery({ queryKey: [...rootKey, 'detail', matchId], queryFn: async () => (await adminClient.resultDetail(matchId)).data });
  if (detail.error) return <p className="error">{detail.error.message}</p>;
  if (!detail.data) return <p className="muted">Loading…</p>;
  const item = detail.data;
  const canEnter = !item.result && ['IN_PROGRESS', 'AWAITING_RESULT'].includes(item.status);
  return (
    <article className="venue-card">
      <h3>{item.sides.HOME} v {item.sides.AWAY}</h3>
      <p className="muted">{item.name} · {item.venueName} · {when(item.startsAt)}–{when(item.matchEndsAt)} · {item.status}</p>
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
    </article>
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

function ProblemQueue({ onOpenMatch }: { onOpenMatch: (matchId: string) => void }) {
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const problems = useQuery({ queryKey: [...rootKey, 'problems', status], queryFn: async () => (await adminClient.resultProblems(status)).data });
  return (
    <div>
      <div className="row">
        <button className={status === 'OPEN' ? '' : 'ghost'} onClick={() => setStatus('OPEN')}>Open</button>
        <button className={status === 'RESOLVED' ? '' : 'ghost'} onClick={() => setStatus('RESOLVED')}>Resolved</button>
      </div>
      {problems.error && <p className="error">{problems.error.message}</p>}
      {problems.data?.length === 0 && <p className="muted">No {status.toLowerCase()} reports.</p>}
      {problems.data?.map((problem) => (
        <div key={problem.id}>
          <ProblemCard problem={problem} />
          <button type="button" className="ghost" onClick={() => onOpenMatch(problem.matchId)}>Open the match result</button>
        </div>
      ))}
    </div>
  );
}

function RefereeReport() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [range, setRange] = useState({ from, to });
  const report = useQuery({ queryKey: [...rootKey, 'report', range.from, range.to], queryFn: async () => (await adminClient.refereeReport(range.from, range.to)).data });
  return (
    <div>
      <p className="muted">Matches whose result each referee recorded, by kickoff date. FootyFinder pays referees outside the platform; no amounts are shown here.</p>
      <form className="row" onSubmit={(event) => { event.preventDefault(); setRange({ from, to }); }}>
        <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} required /></label>
        <label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} required /></label>
        <button>Show</button>
      </form>
      {report.error && <p className="error">{report.error.message}</p>}
      {report.data?.length === 0 && <p className="muted">No refereed matches in this period.</p>}
      {report.data?.map((row) => (
        <details key={row.referee.id} className="venue-card">
          <summary><strong>{row.referee.displayName}</strong>: {row.matchCount} match(es)</summary>
          <ul>{row.matches.map((match) => <li key={match.matchId}>{when(match.startsAt)} · {match.name} · {match.venueName}</li>)}</ul>
        </details>
      ))}
    </div>
  );
}
