import type { AdminRefereeMatch } from '@footy-finder/shared';
import { ApiError } from '@footy-finder/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminClient } from './api.js';
import { AdminActionError } from './FreshMfa.js';

const rootKey = ['admin', 'referee-matches'] as const;
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { timeStyle: 'short' });
const ACTION_LABEL: Record<AdminRefereeMatch['history'][number]['action'], string> = {
  ASSIGNED: 'assigned',
  AUTO_ASSIGNED: 'assigned automatically (default referee)',
  REMOVED: 'removed',
  DECLINED: 'declined',
  ROLE_REVOKED: 'removed (referee role revoked)',
};

/**
 * Gate 8 / TKT-802 (DEC-020): every match needs a referee by T-30 or it is cancelled (D2). Admins
 * assign or change referees here; a referee who is busy with an overlapping match (kickoff to end
 * plus 30 minutes of travel, D27) cannot be picked.
 */
export function MatchRefereesPage() {
  const [view, setView] = useState<'unassigned' | 'upcoming'>('unassigned');
  const matches = useQuery({
    queryKey: [...rootKey, view],
    queryFn: async () => (await adminClient.refereeMatches(view)).data,
    refetchInterval: 30_000,
  });
  return (
    <section>
      <p className="eyebrow">Match officials</p>
      <h2>Match referees</h2>
      <p className="muted">
        A match without an active referee 30 minutes before kickoff is cancelled and every player is refunded. New
        matches get the default referee automatically when they are free; otherwise they appear here and admins are
        alerted.
      </p>
      <div className="row">
        <button className={view === 'unassigned' ? '' : 'ghost'} onClick={() => setView('unassigned')}>
          Unassigned
        </button>
        <button className={view === 'upcoming' ? '' : 'ghost'} onClick={() => setView('upcoming')}>
          All upcoming
        </button>
      </div>
      {matches.error && <p className="error">{matches.error.message}</p>}
      {matches.data?.length === 0 && (
        <p className="muted">{view === 'unassigned' ? 'Every upcoming match has a referee.' : 'No upcoming matches.'}</p>
      )}
      {matches.data?.map((match) => <RefereeMatchCard key={match.matchId} match={match} />)}
    </section>
  );
}

function RefereeMatchCard({ match }: { match: AdminRefereeMatch }) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [refereeUserId, setRefereeUserId] = useState('');
  const [removeReason, setRemoveReason] = useState('');
  const options = useQuery({
    queryKey: [...rootKey, 'options', match.matchId],
    queryFn: async () => (await adminClient.refereeOptions(match.matchId)).data,
    enabled: open,
  });
  const refresh = () => void cache.invalidateQueries({ queryKey: rootKey });
  const assign = useMutation({
    mutationFn: () => adminClient.assignReferee(match.matchId, { refereeUserId }),
    onSuccess: () => {
      setRefereeUserId('');
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => adminClient.removeReferee(match.matchId, { reason: removeReason }),
    onSuccess: () => {
      setRemoveReason('');
      refresh();
    },
  });
  const busyClash =
    assign.error instanceof ApiError && assign.error.code === 'REFEREE_BUSY' ? assign.error.message : undefined;
  const inactive = match.referee && !match.referee.activeReferee;
  return (
    <article className="venue-card">
      <strong>{match.name}</strong>
      <p className="muted">
        {match.mode === 'TEAM_MATCH' ? 'Team match' : 'Quick match'} · {match.format.replaceAll('_', ' ')} ·{' '}
        {match.venueName} · {when(match.startsAt)}–{time(match.matchEndsAt)} · {match.status}
      </p>
      <p>
        Referee:{' '}
        {match.referee ? (
          <>
            <strong>{match.referee.displayName}</strong>
            {inactive && <span className="error"> (no longer an active referee: assign someone else)</span>}
          </>
        ) : (
          <span className="error">none: the match is cancelled at {time(match.goNoGoAt)} unless one is assigned</span>
        )}
      </p>
      <button type="button" className="ghost" onClick={() => setOpen(!open)}>
        {open ? 'Close' : match.referee ? 'Change or remove referee' : 'Assign referee'}
      </button>
      {open && (
        <>
          <div className="row">
            <label>
              Referee
              <select value={refereeUserId} onChange={(event) => setRefereeUserId(event.target.value)}>
                <option value="">Choose a referee</option>
                {options.data?.map((option) => (
                  <option key={option.userId} value={option.userId} disabled={option.busy}>
                    {option.displayName}
                    {option.isDefault ? ' (default)' : ''}
                    {option.clash
                      ? ` (busy: ${option.clash.name}, ${time(option.clash.startsAt)}–${time(option.clash.matchEndsAt)})`
                      : ''}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={!refereeUserId || assign.isPending} onClick={() => assign.mutate()}>
              {match.referee ? 'Change referee' : 'Assign referee'}
            </button>
          </div>
          {options.data?.length === 0 && <p className="muted">There are no active referees. Add one on the Referees page.</p>}
          {busyClash ? <p className="error">{busyClash}</p> : <AdminActionError error={assign.error} />}
          {match.referee && (
            <div className="row">
              <input
                aria-label="Reason for removing the referee"
                placeholder="Reason for removing the referee"
                value={removeReason}
                onChange={(event) => setRemoveReason(event.target.value)}
              />
              <button
                type="button"
                className="danger"
                disabled={removeReason.trim().length < 3 || remove.isPending}
                onClick={() => remove.mutate()}
              >
                Remove referee
              </button>
            </div>
          )}
          <AdminActionError error={remove.error} />
          {match.history.length > 0 && (
            <ul>
              {match.history.map((entry) => (
                <li key={entry.id} className="muted">
                  {when(entry.createdAt)}: {entry.referee.displayName} {ACTION_LABEL[entry.action]}
                  {entry.actor ? ` by ${entry.actor.displayName}` : ''}
                  {entry.reason ? `: ${entry.reason}` : ''}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}
