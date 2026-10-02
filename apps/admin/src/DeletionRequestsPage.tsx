import type { AdminAccountDeletionRequest } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminClient } from './api.js';
import { AdminActionError } from './FreshMfa.js';

const rands = (cents: number) => `R${(cents / 100).toFixed(2)}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const deletionsKey = ['admin', 'account-deletions'] as const;
const FILTERS = [
  ['', 'All'],
  ['GRACE', 'In grace period'],
  ['WAITING', 'Waiting'],
  ['COMPLETED', 'Completed'],
  ['BLOCKED', 'Blocked'],
  ['CANCELLED', 'Cancelled'],
] as const;
const BLOCKER_LABELS: Record<string, string> = {
  ADMIN: 'admin account',
  REFEREE: 'referee',
  ACCOUNT_RESTRICTED: 'suspended or banned',
  MATCH_LOCKED: 'in a locked or live match',
  HOSTING_MATCH: 'hosting a match others joined',
  TEAM_OWNER_HAS_MEMBERS: 'owns a team with members',
  TEAM_OWNER_HAS_MONEY: 'owns a team with Team Wallet money',
  TEAM_OWNER_UPCOMING_MATCH: 'owns a team with an upcoming Team Match',
  OPEN_DISPUTE: 'open chargeback',
  NEGATIVE_BALANCE: 'wallet below zero or paused',
  REFUND_IN_PROGRESS: 'refund in progress',
  TOP_UP_PENDING: 'top-up being confirmed',
  TEAM_MONEY_HELD: 'Team Wallet money held in a Fill Meter',
  WALLET_HOLD: 'wallet money on hold',
  OWNED_TEAM_NOT_CLOSABLE: 'owned team cannot be closed yet',
  ACCOUNT_ACTIVE_AGAIN: 'account active again',
};
const reasons = (codes: string[]) => codes.map((code) => BLOCKER_LABELS[code] ?? code).join(', ');

function SettleForm({ request }: { request: AdminAccountDeletionRequest }) {
  const cache = useQueryClient();
  const [note, setNote] = useState('');
  const settle = useMutation({
    mutationFn: () => adminClient.settleAccountClosure(request.id, note),
    onSuccess: () => {
      setNote('');
      void cache.invalidateQueries({ queryKey: deletionsKey });
    },
  });
  return (
    <form className="row" onSubmit={(event: FormEvent) => { event.preventDefault(); settle.mutate(); }}>
      <label>
        How the money was returned
        <input value={note} onChange={(event) => setNote(event.target.value)} minLength={5} maxLength={500} required placeholder="e.g. R25 paid by EFT on 12 Oct, ref 123" />
      </label>
      <button disabled={settle.isPending || note.trim().length < 5}>Mark money settled</button>
      <AdminActionError error={settle.error} onVerified={() => settle.reset()} />
    </form>
  );
}

function RequestCard({ request }: { request: AdminAccountDeletionRequest }) {
  const openRefunds = request.refunds.filter(({ status }) => !['PROCESSED', 'RESTORED_TO_WALLET'].includes(status));
  return (
    <article className="venue-card">
      <h3>
        {request.displayName} · {request.status.toLowerCase()}
      </h3>
      <p className="muted">
        <code>{request.userId}</code> · requested {when(request.requestedAt)}
      </p>
      {request.status === 'BLOCKED' && <p>Refused: {reasons(request.blockedReasons)}</p>}
      {(request.status === 'GRACE' || request.status === 'WAITING') && (
        <p>
          Final step {request.status === 'WAITING' ? 'waiting' : 'scheduled'} for {when(request.scheduledFor)}
          {request.waitingReason ? ` · waiting for: ${reasons(request.waitingReason.split(','))} (checked ${when(request.lastCheckedAt)})` : ''}
        </p>
      )}
      {request.status === 'CANCELLED' && <p>Cancelled by signing in {when(request.cancelledAt)}</p>}
      {request.status === 'COMPLETED' && (
        <>
          <p>
            Anonymised {when(request.completedAt)} · final email {request.finalEmailSentAt ? 'sent' : 'not sent yet'} · wallet now {rands(request.walletBalanceCents)}
          </p>
          {request.refunds.map((refund, index) => (
            <p key={refund.refundId ?? index}>
              Refund {rands(refund.amountCents)} to {refund.method ?? 'card'} · {refund.status}
            </p>
          ))}
          {request.uncoveredCents > 0 && <p className="error">{rands(request.uncoveredCents)} could not be refunded to a top-up and must be returned by finance.</p>}
          {request.contactEmail && <p>Finance contact (kept until settled): {request.contactEmail}</p>}
          {openRefunds.length > 0 && (
            <p>
              Open refunds are handled on the <Link to="/finance">Finance page</Link> under "Refunds needing attention".
            </p>
          )}
          {request.financeSettledAt ? (
            <p className="muted">Money settled {when(request.financeSettledAt)}{request.financeNote ? `: ${request.financeNote}` : ''}</p>
          ) : (
            request.contactEmail && openRefunds.length === 0 && <SettleForm request={request} />
          )}
        </>
      )}
    </article>
  );
}

/**
 * CEO batch 5, item 6: self-service deletion requests. Admins can see them but cannot speed up a deletion or undo
 * a completed anonymisation. Finance only records how a deleted account's remaining money was returned.
 */
export function DeletionRequestsPage() {
  const [status, setStatus] = useState('');
  const requests = useQuery({
    queryKey: [...deletionsKey, status],
    queryFn: async () => (await adminClient.accountDeletions(status || undefined)).data,
  });
  return (
    <section className="stack">
      <div>
        <h2>Deletion requests</h2>
        <p className="muted">
          Players delete their own account in the app. It is deactivated straight away and anonymised 14 days later. Nothing here
          can speed that up or undo it.
        </p>
        <div className="row">
          {FILTERS.map(([value, label]) => (
            <button key={value} type="button" className={status === value ? undefined : 'ghost'} onClick={() => setStatus(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {requests.error && <p className="error">{requests.error.message}</p>}
      {requests.data?.length === 0 && <p className="empty">No deletion requests.</p>}
      {requests.data?.map((request) => <RequestCard key={request.id} request={request} />)}
    </section>
  );
}
