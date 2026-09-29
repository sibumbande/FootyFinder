import type { AdminSettlementBatch, AdminSettlementDue, SettlementBatchStatus, VenueBankDetails } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { adminClient } from './api.js';

const rands = (cents: number) => `R${(cents / 100).toFixed(2)}`;
const key = ['admin', 'settlement'] as const;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' });

/** Bank details form: only fake data outside production. Details are encrypted on the server. */
function BeneficiaryPanel({ row }: { row: AdminSettlementDue }) {
  const cache = useQueryClient();
  const list = useQuery({ queryKey: [...key, 'beneficiaries', row.venue.id], queryFn: async () => (await adminClient.venueBeneficiaries(row.venue.id)).data });
  const [form, setForm] = useState({ displayName: '', bankName: '', accountHolder: '', accountNumber: '', branchCode: '', accountType: 'CHEQUE' as VenueBankDetails['accountType'] });
  const [revealed, setRevealed] = useState<Record<string, VenueBankDetails>>({});
  const refresh = () => void cache.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: () => adminClient.createVenueBeneficiary(row.venue.id, { displayName: form.displayName, details: { bankName: form.bankName, accountHolder: form.accountHolder, accountNumber: form.accountNumber, branchCode: form.branchCode, accountType: form.accountType } }),
    onSuccess: () => { setForm({ ...form, accountNumber: '', branchCode: '' }); refresh(); },
  });
  const approve = useMutation({ mutationFn: (id: string) => adminClient.approveVenueBeneficiary(id), onSuccess: refresh });
  const reveal = useMutation({ mutationFn: async (id: string) => ({ id, details: (await adminClient.revealVenueBeneficiary(id)).data }), onSuccess: ({ id, details }) => setRevealed({ ...revealed, [id]: details }) });
  const error = create.error ?? approve.error ?? reveal.error;
  return <details><summary>Bank details for {row.venue.name}</summary>
    {list.data?.map((item) => <div key={item.id} className="row">
      <span>{item.displayName} · ****{item.accountLast4} · {item.status}</span>
      {item.status === 'PENDING_APPROVAL' && <button type="button" onClick={() => approve.mutate(item.id)}>Approve (different admin)</button>}
      {item.status === 'APPROVED' && !revealed[item.id] && <button type="button" className="ghost" onClick={() => reveal.mutate(item.id)}>Reveal for payment (audited)</button>}
      {revealed[item.id] && <code>{revealed[item.id]!.bankName} · {revealed[item.id]!.accountHolder} · {revealed[item.id]!.accountNumber} · {revealed[item.id]!.branchCode} · {revealed[item.id]!.accountType}</code>}
    </div>)}
    <form className="row" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }}>
      {(['displayName', 'bankName', 'accountHolder', 'accountNumber', 'branchCode'] as const).map((field) => <label key={field}>{field}<input value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} required /></label>)}
      <label>accountType<select value={form.accountType} onChange={(event) => setForm({ ...form, accountType: event.target.value as VenueBankDetails['accountType'] })}>{['CHEQUE', 'SAVINGS', 'TRANSMISSION'].map((item) => <option key={item}>{item}</option>)}</select></label>
      <button disabled={create.isPending}>Add bank details</button>
    </form>
    {error && <p className="error">{error.message}</p>}
  </details>;
}

function BatchCard({ batch }: { batch: AdminSettlementBatch }) {
  const cache = useQueryClient();
  const [payoutReference, setPayoutReference] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const refresh = () => void cache.invalidateQueries({ queryKey: key });
  const approve = useMutation({ mutationFn: () => adminClient.approveSettlement(batch.id), onSuccess: refresh });
  const pay = useMutation({ mutationFn: () => adminClient.markSettlementPaid(batch.id, { payoutReference, evidenceNote }), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: () => adminClient.cancelSettlement(batch.id, cancelReason), onSuccess: refresh });
  const error = approve.error ?? pay.error ?? cancel.error;
  return <article>
    <strong>{batch.venue.name} · week of {day(batch.periodStart)} · {rands(batch.totalCents)} · {batch.status}</strong>
    <span>{batch.payables.length} match(es) {rands(batch.payablesCents)} · adjustments {rands(batch.adjustmentsCents)} · pay to {batch.beneficiary.displayName} ****{batch.beneficiary.accountLast4}</span>
    <span className="muted">Prepared by {batch.preparedByUserId} {new Date(batch.preparedAt).toLocaleString()}{batch.approvedByUserId ? ` · approved by ${batch.approvedByUserId}` : ''}{batch.payoutReference ? ` · paid ref ${batch.payoutReference}` : ''}{batch.cancelReason ? ` · cancelled: ${batch.cancelReason}` : ''}</span>
    <ul>{batch.payables.map((payable) => <li key={payable.id}>{payable.matchName} · kickoff {new Date(payable.kickoffAt).toLocaleString()} · {rands(payable.amountCents)}{payable.adjustmentsCents ? ` (adj ${rands(payable.adjustmentsCents)})` : ''}</li>)}</ul>
    {batch.status === 'PREPARED' && <button type="button" disabled={approve.isPending} onClick={() => approve.mutate()}>Approve (different admin, fresh MFA)</button>}
    {batch.status === 'APPROVED' && <form className="row" onSubmit={(event: FormEvent) => { event.preventDefault(); pay.mutate(); }}>
      <label>Payout reference<input value={payoutReference} onChange={(event) => setPayoutReference(event.target.value)} minLength={4} required /></label>
      <label>Evidence<input value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} minLength={5} required /></label>
      <button disabled={pay.isPending}>Mark paid (not the preparer, fresh MFA)</button>
    </form>}
    {(batch.status === 'PREPARED' || batch.status === 'APPROVED') && <div className="row">
      <input aria-label="Cancel reason" placeholder="Cancel reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
      <button type="button" className="danger" disabled={cancel.isPending || cancelReason.trim().length < 5} onClick={() => cancel.mutate()}>Cancel batch</button>
    </div>}
    {error && <p className="error">{error.message}</p>}
  </article>;
}

export function SettlementsPage() {
  const cache = useQueryClient();
  const [status, setStatus] = useState<SettlementBatchStatus | ''>('');
  const [weeks, setWeeks] = useState<Record<string, string>>({});
  const due = useQuery({ queryKey: [...key, 'due'], queryFn: async () => (await adminClient.settlementDue()).data });
  const batches = useQuery({ queryKey: [...key, 'batches', status], queryFn: async () => (await adminClient.settlementBatches(status || undefined)).data });
  const prepare = useMutation({
    mutationFn: (row: AdminSettlementDue) => adminClient.prepareSettlement({ venueId: row.venue.id, weekStart: weeks[row.venue.id] ?? row.latestClosedWeek }),
    onSuccess: () => void cache.invalidateQueries({ queryKey: key }),
  });
  return <section><div><p className="eyebrow">Admin only · DEC-012</p><h2>Venue settlement</h2><p className="muted">Venues are owed money only for matches that went ahead. Cancelled matches never appear here. One admin prepares a weekly batch; a different admin approves it and marks it paid after making the bank transfer.</p></div>
    <h3>Waiting to be settled</h3>
    {due.error && <p className="error">{due.error.message}</p>}
    {due.data?.length === 0 && <p className="muted">Nothing is due.</p>}
    <div className="audit-list">{due.data?.map((row) => <article key={row.venue.id}>
      <strong>{row.venue.name} · {row.payableCount} match(es) · {rands(row.payablesCents)}{row.unappliedAdjustmentsCents ? ` · adjustments ${rands(row.unappliedAdjustmentsCents)}` : ''}</strong>
      <span>{row.oldestDueAt ? `Oldest kickoff ${new Date(row.oldestDueAt).toLocaleString()}` : 'Adjustments only'} · {row.approvedBeneficiary ? `Pays ${row.approvedBeneficiary.displayName} ****${row.approvedBeneficiary.accountLast4}` : 'No approved bank details yet'}</span>
      <div className="row">
        <label>Week starting (Monday)<input type="date" value={weeks[row.venue.id] ?? row.latestClosedWeek} onChange={(event) => setWeeks({ ...weeks, [row.venue.id]: event.target.value })} /></label>
        <button type="button" disabled={prepare.isPending || !row.approvedBeneficiary} onClick={() => prepare.mutate(row)}>Prepare weekly batch</button>
      </div>
      <BeneficiaryPanel row={row} />
    </article>)}</div>
    {prepare.error && <p className="error">{prepare.error.message}</p>}

    <h3>Settlement batches</h3>
    <div className="row"><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as SettlementBatchStatus | '')}><option value="">All (latest 100)</option>{['PREPARED', 'APPROVED', 'PAID', 'CANCELLED'].map((item) => <option key={item}>{item}</option>)}</select></label></div>
    {batches.error && <p className="error">{batches.error.message}</p>}
    {batches.data?.length === 0 && <p className="muted">No batches.</p>}
    <div className="audit-list">{batches.data?.map((batch) => <BatchCard key={batch.id} batch={batch} />)}</div>
  </section>;
}
