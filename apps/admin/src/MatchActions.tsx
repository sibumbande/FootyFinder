import type { AdminMatchDetail } from '@footy-finder/shared';
import { ApiError } from '@footy-finder/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminClient } from './api.js';
import { useConfirm } from './ConfirmDialog.js';
import { AdminActionError } from './FreshMfa.js';

export const matchesKey = ['admin', 'matches'] as const;
export const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
export const time = (iso: string) => new Date(iso).toLocaleTimeString([], { timeStyle: 'short' });
export const rands = (cents: number) => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(cents / 100);

const ACTION_LABEL: Record<AdminMatchDetail['history'][number]['action'], string> = {
  ASSIGNED: 'assigned',
  AUTO_ASSIGNED: 'assigned automatically (default referee)',
  REMOVED: 'removed',
  DECLINED: 'declined',
  ROLE_REVOKED: 'removed (referee role revoked)',
};

/**
 * Gate 8 / TKT-802 (DEC-020), moved onto the match page in CEO touch-up batch 3.5, item 5: assign, change or
 * remove the referee. A referee busy with an overlapping match (kickoff to end plus 30 minutes, D27) cannot be
 * picked. No fresh MFA (unchanged).
 */
export function RefereePanel({ match }: { match: AdminMatchDetail }) {
  const cache = useQueryClient();
  const [refereeUserId, setRefereeUserId] = useState('');
  const [removeReason, setRemoveReason] = useState('');
  const options = useQuery({
    queryKey: [...matchesKey, 'referee-options', match.matchId],
    queryFn: async () => (await adminClient.refereeOptions(match.matchId)).data,
  });
  const refresh = () => void cache.invalidateQueries({ queryKey: matchesKey });
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
  const busyClash = assign.error instanceof ApiError && assign.error.code === 'REFEREE_BUSY' ? assign.error.message : undefined;
  const inactive = match.referee && !match.referee.activeReferee;
  const over = ['CANCELLED', 'COMPLETED'].includes(match.status);
  return (
    <div className="stack compact-gap" data-testid="referee-panel">
      <h3>Referee</h3>
      <p>
        {match.referee ? (
          <>
            <strong>{match.referee.displayName}</strong>
            {inactive && <span className="error"> (no longer an active referee: assign someone else)</span>}
          </>
        ) : over ? (
          <span className="muted">No referee.</span>
        ) : (
          <span className="error">None: the match is cancelled at {time(match.goNoGoAt)} unless one is assigned.</span>
        )}
      </p>
      {!over && (
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
                    {option.clash ? ` (busy: ${option.clash.name}, ${time(option.clash.startsAt)}–${time(option.clash.matchEndsAt)})` : ''}
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
              <input aria-label="Reason for removing the referee" placeholder="Reason for removing the referee" value={removeReason} onChange={(event) => setRemoveReason(event.target.value)} />
              <button type="button" className="danger" disabled={removeReason.trim().length < 3 || remove.isPending} onClick={() => remove.mutate()}>
                Remove referee
              </button>
            </div>
          )}
          <AdminActionError error={remove.error} />
        </>
      )}
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
    </div>
  );
}

/**
 * CEO touch-up batch 2 (weather/venue cancellation), now only on the match page: before kick-off, every player
 * gets a full refund and is told. Fresh MFA (unchanged). Team matches only before their 30-minute check.
 */
export function CancelPanel({ match }: { match: AdminMatchDetail }) {
  const cache = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => adminClient.cancelMatch(match.matchId, { reason }),
    onSuccess: () => {
      setReason('');
      void cache.invalidateQueries({ queryKey: matchesKey });
    },
  });
  if (match.status === 'CANCELLED') return null;
  return (
    <div className="stack compact-gap" data-testid="cancel-panel">
      {confirmDialog}
      <h3>Cancel match (weather/venue)</h3>
      <p className="muted">
        Before kick-off only. Everyone who paid chooses a match credit or a full refund to their card or bank (refunded
        automatically after 7 days), match credits used are returned, and everyone is told in the app and by email. Your reason is kept in the audit log; players see a fixed sentence.
      </p>
      {!match.cancellable ? (
        <p className="muted">
          {match.mode === 'TEAM_MATCH' && !match.started
            ? 'The 30-minute check has passed, so this team match can no longer be cancelled here.'
            : 'The match has kicked off, so it can no longer be cancelled.'}
        </p>
      ) : (
        <div className="row">
          <input aria-label="Reason for cancelling the match" placeholder="Reason (for the audit log)" value={reason} onChange={(event) => setReason(event.target.value)} />
          <button
            type="button"
            className="danger"
            disabled={reason.trim().length < 5 || cancel.isPending}
            onClick={async () => {
              if (await confirm({
                title: `Cancel ${match.name}?`,
                message: <p>Every player is refunded and notified by email.</p>,
                confirmLabel: 'Cancel match',
                cancelLabel: 'Keep match',
                destructive: true,
              })) cancel.mutate();
            }}
          >
            Cancel match
          </button>
        </div>
      )}
      <AdminActionError error={cancel.error} onVerified={() => cancel.reset()} />
    </div>
  );
}

/** CEO touch-up batch 3.5, item 5: a new invite link for a private match FootyFinder hosts (the old one stops working). */
export function InvitePanel({ match }: { match: AdminMatchDetail }) {
  const [link, setLink] = useState<string>();
  const rotate = useMutation({
    mutationFn: () => adminClient.rotateAdminMatchInvite(match.matchId),
    onSuccess: ({ data }) => setLink(data.inviteUrl),
  });
  if (match.visibility !== 'PRIVATE' || !match.hostedByFootyFinder || ['CANCELLED', 'COMPLETED'].includes(match.status)) return null;
  return (
    <div className="stack compact-gap">
      <h3>Private invite link</h3>
      <p className="muted">Links are shown only once. Making a new one stops the old link from working.</p>
      {link ? <InviteLink url={link} /> : (
        <button type="button" className="ghost" disabled={rotate.isPending} onClick={() => rotate.mutate()}>New invite link</button>
      )}
      <AdminActionError error={rotate.error} />
    </div>
  );
}

export function InviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret" data-testid="invite-link">
      <strong>Invite link (anyone with it can join)</strong>
      <code>{url}</code>
      <button
        type="button"
        className="ghost small"
        onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false))}
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}
