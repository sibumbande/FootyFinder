import type { RetentionCategorySummary } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminClient } from './api.js';
import { AdminActionError } from './FreshMfa.js';
import { useConfirm } from './ConfirmDialog.js';

const retentionKey = ['admin', 'retention'] as const;
const COUNT_LABELS: Record<string, string> = {
  directMessages: 'direct messages',
  lobbyMessages: 'Lobby chat messages',
  teamMessages: 'Team chat messages',
  supportRequests: 'support requests',
  friendRequests: 'friend requests',
  teamInvites: 'team invites',
  joinRequests: 'requests to join',
  recruitmentPosts: 'recruitment posts',
  lookingCards: 'looking cards',
  deletionRecords: 'deletion records',
  notificationsOnDeletedAccounts: 'notifications on deleted accounts',
  bannedAccountsToReview: 'banned accounts to review (never changed automatically)',
  unsubscribedEntries: 'unsubscribed waiting-list entries',
  reports: 'resolved reports',
  enforcements: 'ended suspensions and bans',
  disputes: 'closed disputes',
  walletLedgerRows: 'earlier payment records (players)',
  teamWalletLedgerRows: 'earlier payment records (teams)',
  payments: 'payments',
  refunds: 'refunds',
  auditEntries: 'audit entries',
};
const describeCounts = (counts: Record<string, number>) =>
  Object.entries(counts).map(([kind, count]) => `${count} ${COUNT_LABELS[kind] ?? kind}`).join(' · ');

function Category({ item }: { item: RetentionCategorySummary }) {
  const cache = useQueryClient();
  const setMode = useMutation({
    mutationFn: (mode: 'REPORT' | 'APPLY') => adminClient.setRetentionMode(item.category, mode),
    onSuccess: ({ data }) => cache.setQueryData(retentionKey, data),
  });
  const next = item.mode === 'REPORT' ? 'APPLY' : 'REPORT';
  const { confirm, confirmDialog } = useConfirm();
  return (
    <article className="venue-card">
      {confirmDialog}
      <h3>{item.label}</h3>
      <p className="muted">{item.rule}</p>
      <p>
        Mode: <strong>{item.mode === 'REPORT' ? 'Report only (dry run)' : 'Purge'}</strong>
        {item.reportOnly && ' · always report only'}
      </p>
      {!item.reportOnly && (
        <button
          type="button"
          className={next === 'APPLY' ? undefined : 'ghost'}
          disabled={setMode.isPending}
          onClick={async () => {
            if (next === 'REPORT' || await confirm({
              title: `Purge ${item.label.toLowerCase()} every night?`,
              message: <p>Purged records cannot be recovered.</p>,
              confirmLabel: 'Switch to purge',
              cancelLabel: 'Keep report only',
              destructive: true,
            }))
              setMode.mutate(next);
          }}
        >
          {next === 'APPLY' ? 'Switch to purge' : 'Back to report only'}
        </button>
      )}
      <AdminActionError error={setMode.error} onVerified={() => setMode.reset()} />
      <h4>Recent runs</h4>
      {item.runs.length ? (
        item.runs.map((run) => (
          <p key={run.id} className="muted">
            {new Date(run.startedAt).toLocaleString()} · {run.trigger === 'DAILY' ? 'nightly' : 'report now'} ·{' '}
            {run.mode === 'APPLY' ? `purged ${run.purgedCount}` : 'dry run'} · {describeCounts(run.counts) || 'nothing due'}
          </p>
        ))
      ) : (
        <p className="muted">No runs yet.</p>
      )}
    </article>
  );
}

/**
 * CEO batch 5, item 4: the Terms retention table (clause 8). Every category starts as a dry run; switching one to
 * purge needs a fresh authenticator check, and every run and change is in the audit log.
 */
export function RetentionPage() {
  const cache = useQueryClient();
  const overview = useQuery({ queryKey: retentionKey, queryFn: async () => (await adminClient.retention()).data });
  const report = useMutation({
    mutationFn: () => adminClient.retentionReport(),
    onSuccess: ({ data }) => cache.setQueryData(retentionKey, data),
  });
  return (
    <section className="stack">
      <div>
        <h2>Data retention</h2>
        <p className="muted">
          Runs every night at 02:00. "Report now" is always a dry run: it counts what is due and deletes nothing.
        </p>
        <button type="button" disabled={report.isPending} onClick={() => report.mutate()}>
          {report.isPending ? 'Reporting…' : 'Report now'}
        </button>
        <AdminActionError error={report.error} />
      </div>
      {overview.error && <p className="error">{overview.error.message}</p>}
      {overview.data?.categories.map((item) => <Category key={item.category} item={item} />)}
    </section>
  );
}
