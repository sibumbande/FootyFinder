import type { AdminPayment, AdminPaymentStatus, TicketReconciliationReport } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminClient } from './api.js';
import { useConfirm } from './ConfirmDialog.js';
import { AdminActionError } from './FreshMfa.js';

const rands = (cents: number) => `R${(cents / 100).toFixed(2)}`;
const financeKey = ['admin', 'finance'] as const;

const REFUND_SOURCE: Record<string, string> = {
  ACCOUNT_CLOSURE: 'account closure',
  TICKET_LEFT: 'left the match',
  MATCH_CANCELLED: 'match cancelled',
  CHOICE_TIMEOUT: 'no choice within 7 days',
  LATE_PAYMENT: 'paid after the hold ended',
  DUPLICATE_PAYMENT: 'paid twice',
};

/**
 * DEC-021: a provider payment. A match ticket payment can cover several tickets and is refunded per ticket by the
 * ticket rules; finance never refunds a free-form amount and never returns money "to the wallet" (A7). Payments from
 * before DEC-021 are shown read-only as earlier payment records.
 */
function PaymentCard({ payment }: { payment: AdminPayment }) {
  const cache = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const refresh = () => void cache.invalidateQueries({ queryKey: financeKey });
  const retry = useMutation({ mutationFn: (refundId: string) => adminClient.retryRefund(refundId), onSuccess: refresh });
  return <article>
    {confirmDialog}
    <strong>{payment.purpose === 'TICKETS' ? 'Match ticket payment' : 'Earlier payment record'} · {rands(payment.amountCents)} · {payment.status}{payment.paymentMethod ? ` · ${payment.paymentMethod}` : ''}{payment.creditedBy ? ` (confirmed by ${payment.creditedBy})` : ''}</strong>
    <code>{payment.reference}</code>
    {payment.match && <span><Link to={`/matches/${payment.match.id}`}>{payment.match.name}</Link> · {new Date(payment.match.startsAt).toLocaleString()} · {payment.ticketCount ?? 0} {payment.ticketCount === 1 ? 'ticket' : 'tickets'}</span>}
    <span>{payment.player.username} · {payment.player.email} · {new Date(payment.createdAt).toLocaleString()}</span>
    {payment.accountClosure && <span className="error">The player deleted their account. Contact them at {payment.accountClosure.contactEmail ?? 'the address on the Deletion requests page'} for bank details (ToS 20.2).</span>}
    {payment.reviewReason && <span className="error">Review: {payment.reviewReason}. Check the Paystack dashboard; no ticket was confirmed by this payment.</span>}
    {payment.failureReason && <span className="muted">Failure: {payment.failureReason}</span>}
    {payment.disputes.map((dispute) => <span key={dispute.id}>Dispute {dispute.providerDisputeId}: {dispute.status} · {rands(dispute.amountCents)}{dispute.resolution ? ` · ${dispute.resolution}` : ''}</span>)}
    {payment.refunds.map((item) => <div key={item.id} className="row">
      <span>Refund {rands(item.amountCents)}{item.source && REFUND_SOURCE[item.source] ? ` (${REFUND_SOURCE[item.source]})` : ''} · {item.state} · attempts {item.attempts}{item.failureReason ? ` · ${item.failureReason}` : ''}{item.reviewReason ? ` · REVIEW ${item.reviewReason}` : ''}</span>
      {item.state === 'NEEDS_ATTENTION' && <BankDetailsForm refundId={item.id} onDone={refresh} />}
      {item.state === 'FAILED' && !item.reviewReason && <button type="button" disabled={retry.isPending} onClick={async () => {
        if (item.failureReason === 'PAYSTACK_UNAVAILABLE' && !(await confirm({
          title: 'Retry this refund?',
          message: <p>The last attempt timed out. Confirm in the Paystack dashboard that this refund was NOT processed before retrying.</p>,
          confirmLabel: 'It was not processed: retry',
          cancelLabel: 'Not now',
        }))) return;
        retry.mutate(item.id);
      }}>Retry refund</button>}
    </div>)}
    {retry.error && <AdminActionError error={retry.error} onVerified={() => retry.reset()} />}
  </article>;
}

/**
 * CEO touch-up batch 4, item 3 (D8): Paystack could not send a bank-payment refund back (no bank account on file).
 * Support asks the player; finance enters the bank and account number here. They go to Paystack only; the audit log
 * keeps the bank name and the last 4 digits. Fresh MFA.
 */
function BankDetailsForm({ refundId, onDone }: { refundId: string; onDone: () => void }) {
  const [bankId, setBankId] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const banks = useQuery({ queryKey: [...financeKey, 'banks'], queryFn: async () => (await adminClient.paystackBanks()).data, staleTime: 3_600_000 });
  const bankName = banks.data?.find((bank) => bank.id === bankId)?.name ?? '';
  const send = useMutation({
    mutationFn: () => adminClient.refundBankDetails(refundId, { bankId, bankName, accountNumber }),
    onSuccess: () => { setAccountNumber(''); onDone(); },
  });
  return <form className="row" data-testid="refund-bank-details" onSubmit={(event: FormEvent) => { event.preventDefault(); send.mutate(); }}>
    <span className="muted">Needs the player&apos;s bank details (never stored by FootyFinder).</span>
    <label>Bank<select value={bankId} onChange={(event) => setBankId(event.target.value)} required>
      <option value="">{banks.isPending ? 'Loading banks…' : 'Choose a bank'}</option>
      {banks.data?.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
    </select></label>
    <label>Account number<input inputMode="numeric" autoComplete="off" value={accountNumber} onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, ''))} minLength={6} maxLength={16} required /></label>
    <button disabled={send.isPending || !bankName || accountNumber.length < 6}>Send refund</button>
    {banks.error && <span className="error">{banks.error.message}</span>}
    <AdminActionError error={send.error} onVerified={() => send.reset()} />
  </form>;
}

function Reconciliation({ report }: { report: TicketReconciliationReport }) {
  const { credits } = report;
  return <>
    <div className="module-grid">
      <article><strong>{report.ticketCount}</strong><span>Tickets checked</span></article>
      <article><strong>{report.paymentCount}</strong><span>Ticket payments</span></article>
      <article><strong>{report.refundCount}</strong><span>Refunds</span></article>
      <article><strong>{report.issueCount}</strong><span>Integrity issues</span></article>
    </div>
    <p className="muted" data-testid="credit-totals">Match credits: {credits.issued} issued = {credits.used} used + {credits.expired} expired + {credits.forfeited} lapsed + {credits.refunded} refunded + {credits.outstanding} outstanding.</p>
    {report.issueCount === 0
      ? <div className="secret"><strong>Reconciliation passed</strong><span>Generated {new Date(report.generatedAt).toLocaleString()}</span></div>
      : <div className="audit-list">{report.issues.map((issue, index) => <article key={`${issue.code}-${issue.referenceId}-${index}`}><strong>{issue.code}</strong><code>{issue.referenceId}</code><span>Expected {issue.expectedCents ?? 'n/a'} cents · actual {issue.actualCents ?? 'n/a'} cents{issue.detail ? ` · ${issue.detail}` : ''}</span></article>)}</div>}
    <p className="muted">Also checked {report.payableCount} venue payables and {report.settlementBatchCount} settlement batches.</p>
  </>;
}

export function FinancePage() {
  const [status, setStatus] = useState<AdminPaymentStatus | ''>('REVIEW');
  const report = useQuery({ queryKey: [...financeKey, 'reconciliation'], queryFn: async () => (await adminClient.ticketReconciliation()).data });
  const payments = useQuery({ queryKey: [...financeKey, 'payments', status], queryFn: async () => (await adminClient.payments(status ? { status } : {})).data });
  const attention = useQuery({ queryKey: [...financeKey, 'needs-attention'], queryFn: async () => (await adminClient.refundsNeedingAttention()).data });
  return <section><div><p className="eyebrow">Finance</p><h2>Finance & reconciliation</h2><p className="muted">Every payment is a match ticket, confirmed only after our server verifies it with Paystack. Refunds go back to the original payment method; a failed refund is never turned into a match credit.</p></div>
    {report.isPending && <p>Running reconciliation…</p>}
    {report.error && <p className="error">{report.error.message}</p>}
    {report.data && <Reconciliation report={report.data} />}

    <h3>Refunds needing attention</h3>
    <p className="muted">Bank refunds waiting for the player&apos;s account details, failed refunds and refunds flagged for review, including refunds from deleted accounts. See also <Link to="/deletion-requests">Deletion requests</Link>.</p>
    {attention.error && <p className="error">{attention.error.message}</p>}
    {attention.data?.length === 0 && <p className="muted">Nothing needs attention.</p>}
    <div className="audit-list" data-testid="refunds-needing-attention">{attention.data?.map((payment) => <PaymentCard key={payment.id} payment={payment} />)}</div>

    <h3>Payments</h3>
    <div className="row"><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as AdminPaymentStatus | '')}><option value="">All (latest 100)</option>{['REVIEW', 'INITIALIZED', 'SUCCEEDED', 'FAILED'].map((item) => <option key={item}>{item}</option>)}</select></label></div>
    {payments.error && <p className="error">{payments.error.message}</p>}
    {payments.data?.length === 0 && <p className="muted">No payments in this state.</p>}
    <div className="audit-list">{payments.data?.map((payment) => <PaymentCard key={payment.id} payment={payment} />)}</div>

    <p className="muted">Payment disputes (chargebacks) and booking restrictions are on <Link to="/payment-disputes">Payment disputes</Link>.</p>
    <FreeMatchCosts />
  </section>;
}

/**
 * CEO touch-up batch 3, item 5: what free "On FootyFinder" matches cost. Fees waived = R80 x players covered
 * (promotional cost, never a player's money); the real cash cost is the venue payable raised at kickoff (before
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
