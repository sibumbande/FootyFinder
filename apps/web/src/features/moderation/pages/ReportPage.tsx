import type { ModerationReportReason, ModerationReportTargetType } from '@footy-finder/shared';
import { useMutation } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { moderationClient } from '@/api/client.js';

const targetTypes = new Set<ModerationReportTargetType>(['USER', 'DIRECT_MESSAGE', 'LOBBY_MESSAGE', 'TEAM', 'MATCH']);
const reasons: ModerationReportReason[] = ['HARASSMENT', 'ABUSE', 'CHEATING', 'SPAM', 'IMPERSONATION', 'SAFETY', 'OTHER'];

export function ReportPage() {
  const navigate = useNavigate();
  const { targetType: rawTargetType, targetId } = useParams();
  const targetType = targetTypes.has(rawTargetType as ModerationReportTargetType) ? rawTargetType as ModerationReportTargetType : undefined;
  const [reason, setReason] = useState<ModerationReportReason>('HARASSMENT');
  const [details, setDetails] = useState('');
  const submit = useMutation({
    mutationFn: () => moderationClient.createReport({ targetType: targetType!, targetId: targetId!, reason, ...(details.trim() ? { details } : {}) }),
  });
  if (!targetType || !targetId) return <section className="panel"><h1>Invalid report target</h1><Link to="/">Return home</Link></section>;
  if (submit.isSuccess) return <section className="panel space-y-4"><h1>Report received</h1><p>Our safety team can now review the preserved evidence and your notes.</p><button onClick={() => navigate(-1)}>Go back</button></section>;
  return <section className="panel mx-auto max-w-2xl space-y-5"><div><p className="eyebrow">Safety report</p><h1>Tell us what happened</h1><p className="text-content-muted">The relevant content is snapshotted securely when you submit. Other players cannot see your report.</p></div><form className="space-y-4" onSubmit={(event: FormEvent) => { event.preventDefault(); submit.mutate(); }}><label className="field">Reason<select value={reason} onChange={(event) => setReason(event.target.value as ModerationReportReason)}>{reasons.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><label className="field">What should the safety team know?<textarea value={details} onChange={(event) => setDetails(event.target.value)} minLength={3} maxLength={2000} /></label>{submit.error && <p className="error">{submit.error.message}</p>}<div className="flex gap-3"><button disabled={submit.isPending}>{submit.isPending ? 'Submitting…' : 'Submit report'}</button><button type="button" className="button-secondary" onClick={() => navigate(-1)}>Cancel</button></div></form></section>;
}
