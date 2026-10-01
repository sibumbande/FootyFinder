import type { AdminRefereeMatch } from '@footy-finder/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminClient } from './api.js';
import { AdminActionError } from './FreshMfa.js';

/**
 * CEO touch-up batch 3, item 5: make an empty Quick Match free ("On FootyFinder"), optionally for first-time
 * players only, or make it paid again. Fresh MFA, a reason and an audit entry; only while nobody has joined.
 */
export function FreeMatchControl({ match, rootKey }: { match: AdminRefereeMatch; rootKey: readonly unknown[] }) {
  const cache = useQueryClient();
  const [reason, setReason] = useState('');
  const [firstTimersOnly, setFirstTimersOnly] = useState(match.firstTimersOnly);
  const mark = useMutation({
    mutationFn: (free: boolean) => adminClient.markFreeMatch(match.matchId, { free, firstTimersOnly: free && firstTimersOnly, reason }),
    onSuccess: () => {
      setReason('');
      void cache.invalidateQueries({ queryKey: rootKey });
    },
  });
  return (
    <div className="stack compact-gap" data-testid="free-match-control">
      <h3>Free match (On FootyFinder)</h3>
      <p className="muted">
        {match.freeOnFootyFinder
          ? `This match is free${match.firstTimersOnly ? ' for first-time players only' : ''}. FootyFinder covers each player's R80 and still pays the venue.`
          : 'Players join for R0 and FootyFinder covers each R80 (recorded as a promotional cost). Leaving or a cancellation refunds nothing.'}
      </p>
      {!match.canBeMadeFree ? (
        <p className="muted">{match.mode === 'QUICK_GAME' ? 'Players have joined, so this can no longer be changed.' : 'Only Quick Matches can be free.'}</p>
      ) : (
        <div className="row">
          {!match.freeOnFootyFinder && (
            <label className="check"><input type="checkbox" checked={firstTimersOnly} onChange={(event) => setFirstTimersOnly(event.target.checked)} />First-time players only</label>
          )}
          <input aria-label="Reason for changing the match price" placeholder="Reason (for the audit log)" value={reason} onChange={(event) => setReason(event.target.value)} />
          <button type="button" disabled={reason.trim().length < 5 || mark.isPending} onClick={() => mark.mutate(!match.freeOnFootyFinder)}>
            {match.freeOnFootyFinder ? 'Undo free (back to R80)' : 'Make free (On FootyFinder)'}
          </button>
        </div>
      )}
      <AdminActionError error={mark.error} onVerified={() => mark.reset()} />
    </div>
  );
}
