import type { MatchFormat } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { adminClient } from './api.js';

const matchesKey = ['admin', 'managed-matches'] as const;
export function MatchLoadingPage() {
  const cache = useQueryClient();
  const [fieldId, setFieldId] = useState(''); const [name, setName] = useState(''); const [startsAt, setStartsAt] = useState(''); const [format, setFormat] = useState<MatchFormat>('FIVE_A_SIDE');
  const venues = useQuery({ queryKey: ['admin', 'venues'], queryFn: async () => (await adminClient.venues()).data });
  const matches = useQuery({ queryKey: matchesKey, queryFn: async () => (await adminClient.managedMatches()).data });
  const field = venues.data?.flatMap((venue) => venue.fields).find((item) => item.id === fieldId);
  useEffect(() => { if (field && !field.supportedFormats.includes(format)) setFormat(field.supportedFormats[0] ?? 'FIVE_A_SIDE'); }, [field, format]);
  const create = useMutation({ mutationFn: () => adminClient.createManagedMatch({ managedFieldId: fieldId, name, format, substituteCapacityPerTeam: 5, rollingSubstitutes: true, rules: [], visibility: 'PUBLIC', startsAt: new Date(startsAt).toISOString() }), onSuccess: () => { void cache.invalidateQueries({ queryKey: matchesKey }); setName(''); } });
  return <section><div><p className="eyebrow">Operations inventory</p><h2>Load Matches</h2><p className="muted">Create a public Quick Game on a configured field. The effective price and venue details are snapshotted; Admin loading does not touch any personal wallet.</p></div><form className="form-grid two create-panel" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }}><label>Field<select value={fieldId} onChange={(event) => setFieldId(event.target.value)} required><option value="">Select field</option>{venues.data?.filter((venue) => venue.isActive).flatMap((venue) => venue.fields.filter((item) => item.status === 'ACTIVE').map((item) => <option value={item.id} key={item.id}>{venue.name} — {item.name}</option>))}</select></label><label>Match name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Format<select value={format} onChange={(event) => setFormat(event.target.value as MatchFormat)}>{field?.supportedFormats.map((item) => <option key={item}>{item}</option>)}</select></label><label>Kickoff<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label><button disabled={create.isPending}>Reserve field & publish Match</button>{create.error && <p className="error">{create.error.message}</p>}</form><div className="audit-list">{matches.data?.map((item) => <article key={item.id}><div className="row between"><strong>{item.match.name}</strong><span>{item.status}</span></div><span>{item.venueName} — {item.fieldName} · {new Date(item.startsAt).toLocaleString()}</span><code>R {(item.priceCents / 100).toFixed(2)} immutable price snapshot · {item.source}</code></article>)}</div></section>;
}
