import type { MatchLineupPlayer, RefereeMatchDetail } from '@footy-finder/shared';
import { useState } from 'react';
import { FormError } from '@/components/ui/FormError.js';
import { useSubmitRefereeResult } from '../hooks/useReferee.js';
import {
  describeGoals,
  draftProblems,
  emptyResultDraft,
  scoreOf,
  toRefereeResultInput,
  type GoalDraft,
  type ResultDraft,
} from '../result-draft.js';

const selectClass = 'min-h-11 w-full rounded-xl border-2 border-line bg-surface px-3 text-sm text-content';
let goalKey = 0;

/**
 * Gate 8 / TKT-805 (DEC-020): the referee's result form, built for a phone. Goals are added one
 * at a time; scorers and assisters are picked from that side's lineup; an own goal names nobody
 * (D7); unticking a player records that they did not play (D14). A confirm step says the result
 * is final (D5) before anything is sent.
 */
export function RefereeResultForm({ match }: { match: RefereeMatchDetail }) {
  const [draft, setDraft] = useState<ResultDraft>(emptyResultDraft);
  const [confirming, setConfirming] = useState(false);
  const submit = useSubmitRefereeResult(match.matchId);
  const problems = draftProblems(draft, match.lineup);
  const played = (side: 'HOME' | 'AWAY') =>
    match.lineup.filter((player) => player.side === side && !draft.didNotPlayUserIds.includes(player.userId));
  const update = (patch: Partial<ResultDraft>) => {
    setConfirming(false);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const updateGoal = (key: string, patch: Partial<GoalDraft>) =>
    update({ goals: draft.goals.map((goal) => (goal.key === key ? { ...goal, ...patch } : goal)) });
  const addGoal = (side: 'HOME' | 'AWAY') =>
    update({ goals: [...draft.goals, { key: String(goalKey++), side, ownGoal: false, scorerUserId: '', assistUserId: '' }] });
  const toggleDidNotPlay = (userId: string) =>
    update({
      didNotPlayUserIds: draft.didNotPlayUserIds.includes(userId)
        ? draft.didNotPlayUserIds.filter((id) => id !== userId)
        : [...draft.didNotPlayUserIds, userId],
    });

  if (submit.isSuccess)
    return <p role="status" className="rounded-2xl border-2 border-brand-200 bg-brand-50 p-4 font-bold text-brand-700">Result recorded. It is now final.</p>;

  return (
    <section className="grid gap-5 rounded-2xl border-2 border-line bg-surface p-4" aria-label="Record the result">
      <h2 className="text-xl font-black text-content-strong">Record the result</h2>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-bold text-content-strong">What happened?</legend>
        {([
          ['PLAYED', 'The match was played'],
          ['FORFEIT', 'Forfeit: a team did not turn up'],
          ['ABANDONED', 'Abandoned: no result counts'],
        ] as const).map(([value, label]) => (
          <label key={value} className="flex min-h-11 items-center gap-3 text-sm text-content">
            <input type="radio" name="outcome" checked={draft.outcome === value} onChange={() => update({ outcome: value })} />
            {label}
          </label>
        ))}
      </fieldset>

      {draft.outcome === 'FORFEIT' && (
        <label className="grid gap-1 text-sm font-bold text-content-strong">
          Who wins the forfeit?
          <select className={selectClass} value={draft.forfeitWinner} onChange={(event) => update({ forfeitWinner: event.target.value as ResultDraft['forfeitWinner'] })}>
            <option value="">Choose a team</option>
            <option value="HOME">{match.sides.HOME}</option>
            <option value="AWAY">{match.sides.AWAY}</option>
          </select>
        </label>
      )}

      {draft.outcome === 'PLAYED' && (
        <>
          <p data-testid="referee-score" className="text-center text-2xl font-black text-content-strong">
            {match.sides.HOME} {scoreOf(draft, 'HOME')} - {scoreOf(draft, 'AWAY')} {match.sides.AWAY}
          </p>
          {(['HOME', 'AWAY'] as const).map((side) => (
            <div key={side} className="grid gap-3">
              <h3 className="font-black text-content-strong">{match.sides[side]} goals</h3>
              {draft.goals.filter((goal) => goal.side === side).map((goal, index) => (
                <GoalRow
                  key={goal.key}
                  label={`${match.sides[side]} goal ${index + 1}`}
                  goal={goal}
                  players={played(side)}
                  onChange={(patch) => updateGoal(goal.key, patch)}
                  onRemove={() => update({ goals: draft.goals.filter((item) => item.key !== goal.key) })}
                />
              ))}
              <button type="button" className="button-secondary min-h-11" onClick={() => addGoal(side)}>
                Add a {match.sides[side]} goal
              </button>
            </div>
          ))}
        </>
      )}

      <fieldset className="grid gap-1">
        <legend className="text-sm font-bold text-content-strong">Who played? Untick anyone who did not play.</legend>
        {match.lineup.map((player) => (
          <label key={player.userId} className="flex min-h-11 items-center gap-3 text-sm text-content">
            <input type="checkbox" checked={!draft.didNotPlayUserIds.includes(player.userId)} onChange={() => toggleDidNotPlay(player.userId)} />
            {player.displayName} <span className="text-content-muted">({match.sides[player.side]}{player.role === 'SUBSTITUTE' ? ', sub' : ''})</span>
          </label>
        ))}
      </fieldset>

      {problems.length > 0 && (
        <ul className="grid gap-1 text-sm font-semibold text-warning-700" data-testid="referee-result-problems">
          {problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      )}
      {!confirming ? (
        <button type="button" className="button min-h-12" disabled={problems.length > 0} onClick={() => setConfirming(true)}>
          Review result
        </button>
      ) : (
        <div className="grid gap-3 rounded-xl border-2 border-warning-300 bg-warning-50 p-4" role="alertdialog" aria-label="Confirm the final result">
          <p className="font-black text-content-strong">
            {draft.outcome === 'PLAYED'
              ? `${match.sides.HOME} ${scoreOf(draft, 'HOME')} - ${scoreOf(draft, 'AWAY')} ${match.sides.AWAY}`
              : draft.outcome === 'FORFEIT'
                ? `${draft.forfeitWinner ? match.sides[draft.forfeitWinner] : ''} win by forfeit`
                : 'Match abandoned: no result counts'}
          </p>
          {draft.outcome === 'PLAYED' && (
            <ul className="text-sm text-content">{describeGoals(draft, match.lineup, match.sides).map((line, index) => <li key={index}>{line}</li>)}</ul>
          )}
          {draft.didNotPlayUserIds.length > 0 && (
            <p className="text-sm text-content">
              Did not play: {match.lineup.filter((player) => draft.didNotPlayUserIds.includes(player.userId)).map((player) => player.displayName).join(', ')}
            </p>
          )}
          <p className="text-sm font-bold text-content-strong">This result is final. You cannot change it after you submit.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="button min-h-11" disabled={submit.isPending} onClick={() => submit.mutate(toRefereeResultInput(draft))}>
              Submit final result
            </button>
            <button type="button" className="button-secondary min-h-11" onClick={() => setConfirming(false)}>
              Back
            </button>
          </div>
        </div>
      )}
      <FormError message={submit.error?.message} />
    </section>
  );
}

function GoalRow({
  label,
  goal,
  players,
  onChange,
  onRemove,
}: {
  label: string;
  goal: GoalDraft;
  players: MatchLineupPlayer[];
  onChange: (patch: Partial<GoalDraft>) => void;
  onRemove: () => void;
}) {
  const OWN = '__own_goal__';
  return (
    <div className="grid gap-2 rounded-xl border border-line p-3" aria-label={label}>
      <label className="grid gap-1 text-sm font-bold text-content-strong">
        Scorer
        <select
          className={selectClass}
          value={goal.ownGoal ? OWN : goal.scorerUserId}
          onChange={(event) =>
            event.target.value === OWN
              ? onChange({ ownGoal: true, scorerUserId: '', assistUserId: '' })
              : onChange({ ownGoal: false, scorerUserId: event.target.value, assistUserId: goal.assistUserId === event.target.value ? '' : goal.assistUserId })}
        >
          <option value="">Choose the scorer</option>
          {players.map((player) => <option key={player.userId} value={player.userId}>{player.displayName}</option>)}
          <option value={OWN}>Own goal by an opponent</option>
        </select>
      </label>
      {!goal.ownGoal && (
        <label className="grid gap-1 text-sm font-bold text-content-strong">
          Assist (optional)
          <select className={selectClass} value={goal.assistUserId} onChange={(event) => onChange({ assistUserId: event.target.value })}>
            <option value="">No assist</option>
            {players.filter((player) => player.userId !== goal.scorerUserId).map((player) => (
              <option key={player.userId} value={player.userId}>{player.displayName}</option>
            ))}
          </select>
        </label>
      )}
      <button type="button" className="justify-self-start text-sm font-bold text-danger-700" onClick={onRemove}>
        Remove this goal
      </button>
    </div>
  );
}
