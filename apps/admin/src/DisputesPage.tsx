import type { DisputeStatus, DisputeType } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { adminClient } from './api.js';

const rootKey = ['admin', 'disputes'] as const;
type ScorerDraft = { participantId: string; goals: number };
export function DisputesPage() {
  const cache = useQueryClient();
  const [status, setStatus] = useState<DisputeStatus | ''>('OPEN');
  const [type, setType] = useState<DisputeType | ''>('');
  const [selectedId, setSelectedId] = useState<string>();
  const [summary, setSummary] = useState('');
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [scorers, setScorers] = useState<ScorerDraft[]>([]);
  const list = useQuery({ queryKey: [...rootKey, status, type], queryFn: async () => (await adminClient.disputes({ ...(status ? { status } : {}), ...(type ? { type } : {}) })).data });
  const detail = useQuery({ queryKey: [...rootKey, selectedId], queryFn: async () => (await adminClient.dispute(selectedId!)).data, enabled: Boolean(selectedId) });
  useEffect(() => {
    const evidence = detail.data?.evidenceSnapshot;
    if (detail.data?.type === 'MATCH_RESULT' && evidence) {
      setHomeScore(Number(evidence.homeScore ?? 0));
      setAwayScore(Number(evidence.awayScore ?? 0));
      setScorers(Array.isArray(evidence.scorers) ? evidence.scorers.map((item) => ({ participantId: String((item as Record<string, unknown>).participantId), goals: Number((item as Record<string, unknown>).goals) })) : []);
    }
  }, [detail.data?.id]);
  const refresh = () => void cache.invalidateQueries({ queryKey: rootKey });
  const review = useMutation({ mutationFn: () => adminClient.reviewDispute(selectedId!, { assignedToMe: true }), onSuccess: ({ data }) => { cache.setQueryData([...rootKey, selectedId], data); refresh(); } });
  const resolve = useMutation({
    mutationFn: (outcome: 'RESULT_CONFIRMED' | 'RESULT_CORRECTED' | 'BOOKING_UPHELD' | 'BOOKING_REJECTED') => adminClient.resolveDispute(selectedId!, outcome === 'RESULT_CORRECTED'
      ? { outcome, resolutionSummary: summary, correctedResult: { homeScore, awayScore, scorers } }
      : { outcome, resolutionSummary: summary }),
    onSuccess: ({ data }) => { cache.setQueryData([...rootKey, selectedId], data); refresh(); setSummary(''); },
  });
  const current = detail.data;
  return <section><p className="eyebrow">Authoritative review</p><h2>Disputes</h2><p className="muted">Result corrections create a new immutable revision. Booking outcomes never move money automatically.</p><div className="row"><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as DisputeStatus | '')}><option value="">All</option>{['OPEN','UNDER_REVIEW','RESOLVED','REJECTED'].map((item) => <option key={item}>{item}</option>)}</select></label><label>Type<select value={type} onChange={(event) => setType(event.target.value as DisputeType | '')}><option value="">All</option><option value="MATCH_RESULT">Match result</option><option value="FIELD_BOOKING">Field booking</option></select></label></div><div className="support-layout"><div className="ticket-list">{list.data?.map((item) => <button key={item.id} className={selectedId === item.id ? 'ticket active-ticket' : 'ticket'} onClick={() => setSelectedId(item.id)}><strong>{item.reason.replaceAll('_', ' ')}</strong><span>{item.type.replaceAll('_', ' ')} · {item.status.replaceAll('_', ' ')}</span><small>{item.openedBy?.displayName} · {new Date(item.createdAt).toLocaleString()}</small></button>)}</div><div>{current ? <article className="venue-card"><h3>{current.reason.replaceAll('_', ' ')}</h3><p>{current.details}</p><pre>{JSON.stringify(current.evidenceSnapshot, null, 2)}</pre>{current.resultRevisions?.length ? <div><h4>Immutable result history</h4>{current.resultRevisions.map((revision) => <p key={revision.id}>Revision {revision.revisionNumber}: {revision.homeScore}–{revision.awayScore} · {revision.reason.replaceAll('_', ' ')}</p>)}</div> : null}{['OPEN','UNDER_REVIEW'].includes(current.status) && <><button className="ghost" onClick={() => review.mutate()}>Assign to me & review</button><form className="stack" onSubmit={(event: FormEvent) => event.preventDefault()}><label>Resolution summary<textarea value={summary} onChange={(event) => setSummary(event.target.value)} minLength={10} maxLength={3000} required /></label>{current.type === 'MATCH_RESULT' && <><div className="row"><label>Home score<input type="number" min={0} value={homeScore} onChange={(event) => setHomeScore(Number(event.target.value))} /></label><label>Away score<input type="number" min={0} value={awayScore} onChange={(event) => setAwayScore(Number(event.target.value))} /></label></div><h4>Scorers</h4>{scorers.map((scorer, index) => <div className="row" key={`${scorer.participantId}-${index}`}><input value={scorer.participantId} onChange={(event) => setScorers((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, participantId: event.target.value } : item))} placeholder="Participant UUID" /><input type="number" min={1} value={scorer.goals} onChange={(event) => setScorers((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, goals: Number(event.target.value) } : item))} /><button className="ghost" type="button" onClick={() => setScorers((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div>)}<button className="ghost" type="button" onClick={() => setScorers((items) => [...items, { participantId: '', goals: 1 }])}>Add scorer</button><div className="row"><button disabled={summary.length < 10} onClick={() => resolve.mutate('RESULT_CORRECTED')}>Correct result</button><button className="ghost" disabled={summary.length < 10} onClick={() => resolve.mutate('RESULT_CONFIRMED')}>Confirm original</button></div></>}{current.type === 'FIELD_BOOKING' && <div className="row"><button disabled={summary.length < 10} onClick={() => resolve.mutate('BOOKING_UPHELD')}>Uphold dispute</button><button className="ghost" disabled={summary.length < 10} onClick={() => resolve.mutate('BOOKING_REJECTED')}>Reject dispute</button></div>}</form></>}{current.resolutionSummary && <p><strong>Decision:</strong> {current.resolutionSummary}</p>}{(review.error || resolve.error) && <p className="error">{(review.error ?? resolve.error)?.message}</p>}</article> : <p className="empty">Select a dispute.</p>}</div></div></section>;
}
