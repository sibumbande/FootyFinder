import type { AdminMatchDetail } from '@footy-finder/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminClient } from './api.js';
import { AdminActionError } from './FreshMfa.js';

/**
 * CEO touch-up batch 4, item 1 (D3): switch a match's girls-only rule on (only while no ineligible player is in it) or
 * off (only while nobody is in it). Fresh MFA, a reason and an audit entry.
 */
export function GirlsOnlyControl({ match, rootKey }: { match: AdminMatchDetail; rootKey: readonly unknown[] }) {
  const cache = useQueryClient();
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => adminClient.setGirlsOnly(match.matchId, { girlsOnly: !match.girlsOnly, reason }),
    onSuccess: () => {
      setReason('');
      void cache.invalidateQueries({ queryKey: rootKey });
    },
  });
  return (
    <div className="stack compact-gap" data-testid="girls-only-control">
      <h3>Girls only</h3>
      <p className="muted">
        {match.girlsOnly
          ? 'Only female players can join, claim, be selected or be loaded with a team. It can be opened to everyone only while nobody has joined.'
          : 'Open to everyone. It can become girls-only only while no male player has joined.'}
      </p>
      <div className="row">
        <input aria-label="Reason for changing who can play" placeholder="Reason (for the audit log)" value={reason} onChange={(event) => setReason(event.target.value)} />
        <button type="button" disabled={reason.trim().length < 5 || save.isPending} onClick={() => save.mutate()}>
          {match.girlsOnly ? 'Open to everyone' : 'Make girls only'}
        </button>
      </div>
      <AdminActionError error={save.error} onVerified={() => save.reset()} />
    </div>
  );
}

/**
 * CEO touch-up batch 4, item 1 (D4): correct a player's private gender. Fresh MFA, a reason and an audit entry. Nothing
 * else changes automatically: upcoming girls-only matches the player is now not eligible for are listed to follow up.
 */
export function CorrectGender({ userId, gender, onSaved }: { userId: string; gender: 'MALE' | 'FEMALE' | null | undefined; onSaved: () => void }) {
  const [next, setNext] = useState<'MALE' | 'FEMALE'>(gender === 'MALE' ? 'FEMALE' : 'MALE');
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => adminClient.correctGender(userId, { gender: next, reason }),
    onSuccess: () => {
      setReason('');
      onSaved();
    },
  });
  const affected = save.data?.data.affectedMatches ?? [];
  return (
    <div className="stack compact-gap" data-testid="correct-gender">
      <h4>Gender (private)</h4>
      <p className="muted">Saved: {gender === 'FEMALE' ? 'Female' : gender === 'MALE' ? 'Male' : 'Not given yet'}. Never shown to other players; only decides girls-only matches.</p>
      <div className="row">
        <label>
          Correct to
          <select value={next} onChange={(event) => setNext(event.target.value as 'MALE' | 'FEMALE')}>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
          </select>
        </label>
        <input aria-label="Reason for correcting the gender" placeholder="Reason (for the audit log)" value={reason} onChange={(event) => setReason(event.target.value)} />
        <button type="button" disabled={reason.trim().length < 5 || save.isPending} onClick={() => save.mutate()}>Correct gender</button>
      </div>
      <AdminActionError error={save.error} onVerified={() => save.reset()} />
      {save.isSuccess && (affected.length ? (
        <div className="pending-change">
          <strong>This player is in {affected.length} upcoming girls-only {affected.length === 1 ? 'match' : 'matches'}</strong>
          <span>Nothing was changed automatically. Follow up with the player:</span>
          {affected.map((match) => <Link key={match.matchId} to={`/matches/${match.matchId}`}>{match.name} · {new Date(match.startsAt).toLocaleString()}</Link>)}
        </div>
      ) : <p className="muted">Saved.</p>)}
    </div>
  );
}
