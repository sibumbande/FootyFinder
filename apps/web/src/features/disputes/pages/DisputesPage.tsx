import type { DisputeReason, DisputeType } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { disputesClient } from '@/api/client.js';

const rootKey = ['disputes'] as const;
export function DisputesPage() {
  const { type: rawType, referenceId } = useParams();
  const type = ['MATCH_RESULT', 'FIELD_BOOKING'].includes(rawType ?? '') ? rawType as DisputeType : undefined;
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [reason, setReason] = useState<DisputeReason>(type === 'MATCH_RESULT' ? 'INCORRECT_SCORE' : 'FIELD_QUALITY');
  const [details, setDetails] = useState('');
  const list = useQuery({ queryKey: rootKey, queryFn: async () => (await disputesClient.list()).data });
  const create = useMutation({
    mutationFn: () => disputesClient.create({ type: type!, referenceId: referenceId!, reason, details }),
    onSuccess: () => { void cache.invalidateQueries({ queryKey: rootKey }); navigate('/disputes', { replace: true }); },
  });
  const reasons: DisputeReason[] = type === 'MATCH_RESULT'
    ? ['INCORRECT_SCORE', 'INCORRECT_SCORERS', 'OTHER']
    : ['FIELD_UNAVAILABLE', 'FIELD_QUALITY', 'BOOKING_SERVICE', 'PAYMENT', 'OTHER'];
  return <section className="space-y-6"><div><p className="eyebrow">Resolution centre</p><h1>My disputes</h1><p className="text-content-muted">Submitted evidence and decisions remain attached to the original result or booking.</p></div>{type && referenceId && <form className="panel mx-auto max-w-2xl space-y-4" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }}><h2>Open {type === 'MATCH_RESULT' ? 'result' : 'booking'} dispute</h2><label className="field">Reason<select value={reason} onChange={(event) => setReason(event.target.value as DisputeReason)}>{reasons.map((item) => <option key={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><label className="field">Explain what happened<textarea value={details} onChange={(event) => setDetails(event.target.value)} minLength={10} maxLength={3000} required /></label>{create.error && <p className="error">{create.error.message}</p>}<div className="flex gap-3"><button disabled={create.isPending}>Submit dispute</button><button type="button" className="button-secondary" onClick={() => navigate(-1)}>Cancel</button></div></form>}<div className="grid gap-4">{list.data?.map((item) => <article className="panel" key={item.id}><div className="flex flex-wrap items-center justify-between gap-2"><strong>{item.type.replaceAll('_', ' ')}</strong><span className="badge">{item.status.replaceAll('_', ' ')}</span></div><p className="mt-2">{item.details}</p>{item.resolutionSummary && <p className="mt-3 rounded-xl bg-brand-50 p-3"><strong>Decision:</strong> {item.resolutionSummary}</p>}<small className="text-content-subtle">Opened {new Date(item.createdAt).toLocaleString()}</small></article>)}{list.data?.length === 0 && !type && <p className="panel text-content-muted">No disputes. Return to <Link to="/bookings">bookings</Link> or a completed Match to open one.</p>}</div></section>;
}
