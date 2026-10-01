import type { AdminTopUp, AdminTopUpStatus } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminClient } from './api.js';
import { AdminActionError } from './FreshMfa.js';

const rands = (cents: number) => `R${(cents / 100).toFixed(2)}`;
const financeKey = ['admin', 'finance'] as const;

function TopUpCard({ topUp }: { topUp: AdminTopUp }) {
  const cache = useQueryClient();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [restoreReason, setRestoreReason] = useState('');
  const [attemptKey] = useState(() => crypto.randomUUID());
  const refresh = () => void cache.invalidateQueries({ queryKey: financeKey });
  const refund = useMutation({
    mutationFn: () => adminClient.refundTopUp(topUp.id, { amountCents: Math.round(Number(amount) * 100), reason }, attemptKey),
    onSuccess: () => { setAmount(''); setReason(''); refresh(); },
  });
  const retry = useMutation({ mutationFn: (refundId: string) => adminClient.retryRefund(refundId), onSuccess: refresh });
  const restore = useMutation({
    mutationFn: (refundId: string) => adminClient.restoreRefund(refundId, restoreReason),
    onSuccess: () => { setRestoreReason(''); refresh(); },
  });
  const error = refund.error ?? retry.error ?? restore.error;
  return <article>
    <strong>{rands(topUp.amountCents)} · {topUp.status}{topUp.creditedBy ? ` (credited by ${topUp.creditedBy})` : ''}</strong>
    <code>{topUp.reference}</code>
    <span>{topUp.player.username} · {topUp.player.email} · {new Date(topUp.createdAt).toLocaleString()}</span>
    {topUp.reviewReason && <span className="error">Review: {topUp.reviewReason}. Check the Paystack dashboard; nothing was credited.</span>}
    {topUp.failureReason && <span className="muted">Failure: {topUp.failureReason}</span>}
    {topUp.disputes.map((dispute) => <span key={dispute.id}>Dispute {dispute.providerDisputeId}: {dispute.status} · {rands(dispute.amountCents)}{dispute.resolution ? ` · ${dispute.resolution}` : ''}</span>)}
    {topUp.refunds.map((item) => <div key={item.id} className="row">
      <span>Refund {rands(item.amountCents)} · {item.state} · attempts {item.attempts}{item.failureReason ? ` · ${item.failureReason}` : ''}{item.reviewReason ? ` · REVIEW ${item.reviewReason}` : ''}</span>
      {item.state === 'FAILED' && !item.reviewReason && <>
        <button type="button" disabled={retry.isPending} onClick={() => { if (item.failureReason !== 'PAYSTACK_UNAVAILABLE' || window.confirm('The last attempt timed out. Confirm in the Paystack dashboard that this refund was NOT processed before retrying.')) retry.mutate(item.id); }}>Retry refund</button>
        <input aria-label="Reason for returning to wallet" placeholder="Reason (required)" value={restoreReason} onChange={(event) => setRestoreReason(event.target.value)} />
        <button type="button" className="ghost" disabled={restore.isPending || restoreReason.trim().length < 5} onClick={() => restore.mutate(item.id)}>Return to wallet</button>
      </>}
    </div>)}
    {topUp.refundableCents > 0 && <form className="row" onSubmit={(event: FormEvent) => { event.preventDefault(); refund.mutate(); }}>
      <label>Refund to card (R, max {rands(topUp.refundableCents)})<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
      <label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={500} required /></label>
      <button disabled={refund.isPending}>Refund to card</button>
    </form>}
    {error && <AdminActionError error={error} onVerified={() => { refund.reset(); retry.reset(); restore.reset(); }} />}
  </article>;
}

export function FinancePage() {
  const cache = useQueryClient();
  const [status, setStatus] = useState<AdminTopUpStatus | ''>('REVIEW');
  const [liftReason, setLiftReason] = useState('');
  const report = useQuery({ queryKey: [...financeKey, 'reconciliation'], queryFn: async () => (await adminClient.walletReconciliation()).data });
  const topUps = useQuery({ queryKey: [...financeKey, 'top-ups', status], queryFn: async () => (await adminClient.topUps(status ? { status } : {})).data });
  const restricted = useQuery({ queryKey: [...financeKey, 'restricted'], queryFn: async () => (await adminClient.restrictedWallets()).data });
  const lift = useMutation({
    mutationFn: (userId: string) => adminClient.liftRestriction(userId, liftReason),
    onSuccess: () => { setLiftReason(''); void cache.invalidateQueries({ queryKey: financeKey }); },
  });
  return <section><div><p className="eyebrow">Finance</p><h2>Finance & reconciliation</h2><p className="muted">Card top-ups are credited only after our server verifies them with Paystack. Refunds go back to the original card; a failed refund is never credited back automatically.</p></div>
    {report.isPending && <p>Running reconciliation…</p>}
    {report.error && <p className="error">{report.error.message}</p>}
    {report.data && <><div className="module-grid"><article><strong>{report.data.walletCount}</strong><span>Wallets checked</span></article><article><strong>{report.data.transactionCount}</strong><span>Ledger rows checked</span></article><article><strong>{report.data.activeHoldCount}</strong><span>Active holds</span></article><article><strong>{report.data.issueCount}</strong><span>Integrity issues</span></article></div>
      {report.data.issueCount === 0 ? <div className="secret"><strong>Reconciliation passed</strong><span>Generated {new Date(report.data.generatedAt).toLocaleString()}</span></div> : <div className="audit-list">{report.data.issues.map((issue, index) => <article key={`${issue.code}-${issue.referenceId ?? issue.walletAccountId}-${index}`}><strong>{issue.code}</strong><code>{issue.walletAccountId ?? issue.referenceId}</code><span>Expected {issue.expectedCents ?? 'n/a'} cents · actual {issue.actualCents ?? 'n/a'} cents{issue.detail ? ` · ${issue.detail}` : ''}</span></article>)}</div>}
      <p className="muted">Checked {report.data.providerPaymentCount ?? 0} card top-ups, {report.data.payableCount ?? 0} venue payables and {report.data.settlementBatchCount ?? 0} settlement batches.</p>
    </>}

    <h3>Card top-ups</h3>
    <div className="row"><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as AdminTopUpStatus | '')}><option value="">All (latest 100)</option>{['REVIEW', 'INITIALIZED', 'SUCCEEDED', 'FAILED'].map((item) => <option key={item}>{item}</option>)}</select></label></div>
    {topUps.error && <p className="error">{topUps.error.message}</p>}
    {topUps.data?.length === 0 && <p className="muted">No top-ups in this state.</p>}
    <div className="audit-list">{topUps.data?.map((topUp) => <TopUpCard key={topUp.id} topUp={topUp} />)}</div>

    <h3>Restricted wallets</h3>
    <p className="muted">A chargeback pauses spending. It lifts automatically once the wallet is repaid and no dispute is open.</p>
    {restricted.error && <p className="error">{restricted.error.message}</p>}
    {restricted.data?.length === 0 && <p className="muted">No restricted wallets.</p>}
    <div className="audit-list">{restricted.data?.map((wallet) => <article key={wallet.userId}>
      <strong>{wallet.username} · {rands(wallet.balanceCents)}</strong>
      <span>Restricted {new Date(wallet.restrictedAt).toLocaleString()} · {wallet.reason ?? 'n/a'} · open disputes {wallet.openDisputes}</span>
      {wallet.balanceCents >= 0 && <div className="row"><input aria-label="Reason for lifting" placeholder="Reason (required)" value={liftReason} onChange={(event) => setLiftReason(event.target.value)} /><button type="button" disabled={lift.isPending || liftReason.trim().length < 5} onClick={() => lift.mutate(wallet.userId)}>Lift restriction</button></div>}
    </article>)}</div>
    {lift.error && <p className="error">{lift.error.message}</p>}
    <FreeMatchCosts />
  </section>;
}

/**
 * CEO touch-up batch 3, item 5: what free "On FootyFinder" matches cost. Fees waived = R80 x players covered
 * (promotional cost, never wallet money); the real cash cost is the venue payable raised at kickoff (before
 * kickoff, the expected field price).
 */
function FreeMatchCosts() {
  const report = useQuery({ queryKey: ['admin', 'finance', 'free-matches'], queryFn: async () => (await adminClient.freeMatchCosts()).data });
  const totals = report.data?.totals;
  return <>
    <h3>Free matches (On FootyFinder)</h3>
    <p className="muted">Fees waived are R80 for each player FootyFinder covered. FootyFinder&apos;s actual cost is the venue payable; before kickoff the expected field price is shown.</p>
    {report.error && <p className="error">{report.error.message}</p>}
    {totals && <p data-testid="free-match-totals"><strong>{totals.matchCount} free {totals.matchCount === 1 ? 'match' : 'matches'}</strong> · {totals.playersCovered} {totals.playersCovered === 1 ? 'player' : 'players'} covered · fees waived {rands(totals.feesWaivedCents)} · venue payables {rands(totals.venuePayableCents)} · expected venue cost (not yet played) {rands(totals.expectedVenueCostCents)}</p>}
    {report.data?.matches.length === 0 && <p className="muted">No free matches yet.</p>}
    <div className="audit-list">{report.data?.matches.map((row) => <article key={row.matchId}>
      <strong><Link to={`/matches/${row.matchId}`}>{row.name}</Link>{row.firstTimersOnly ? ' · first-time players only' : ''}</strong>
      <span>{new Date(row.startsAt).toLocaleString()} · {row.status.toLowerCase()} · {row.playersCovered} covered · fees waived {rands(row.feesWaivedCents)} · venue cost {row.venueCostKind === 'NONE' ? 'none' : `${rands(row.venueCostCents)}${row.venueCostKind === 'EXPECTED' ? ' (expected)' : ''}`}</span>
    </article>)}</div>
  </>;
}
