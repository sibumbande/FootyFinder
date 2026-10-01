import type { FieldClosure, FieldClosureClash, FieldClosureInput, ManagedField, ManagedVenue } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminClient } from './api.js';
import { AdminActionError } from './FreshMfa.js';

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const minuteOf = (value: string) => {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
};
const describe = (closure: FieldClosure) =>
  closure.kind === 'ONE_OFF'
    ? `${new Date(closure.startsAt!).toLocaleString()} – ${new Date(closure.endsAt!).toLocaleString()}`
    : `Every ${days[closure.dayOfWeek!]} ${hhmm(closure.startMinute!)}–${hhmm(closure.endMinute!)}, from ${closure.startsOn}${closure.endsOn ? ` until ${closure.endsOn}` : ''}`;

/**
 * CEO touch-up batch 3, item 3: close a field one-off or weekly (venue timezone). Closures go live immediately
 * (fresh MFA, a reason, audited) and the venue stays live. Matches already booked into a closed time are listed
 * here with the existing "Cancel match (weather/venue)" action; nothing is cancelled automatically.
 */
export function FieldClosures({ field, venuesKey }: { field: ManagedField; venuesKey: readonly unknown[] }) {
  const cache = useQueryClient();
  const clashesKey = ['admin', 'closure-clashes', field.id];
  const clashes = useQuery({ queryKey: clashesKey, queryFn: async () => (await adminClient.fieldClosureClashes(field.id)).data });
  const [kind, setKind] = useState<'WEEKLY' | 'ONE_OFF'>('WEEKLY');
  const [day, setDay] = useState(1);
  const [from, setFrom] = useState('18:00');
  const [to, setTo] = useState('20:00');
  const [startsOn, setStartsOn] = useState(new Date().toISOString().slice(0, 10));
  const [endsOn, setEndsOn] = useState('');
  const [oneOffStart, setOneOffStart] = useState('');
  const [oneOffEnd, setOneOffEnd] = useState('');
  const [reason, setReason] = useState('');
  const [removeReason, setRemoveReason] = useState('');
  const store = (venue: ManagedVenue) => cache.setQueryData<ManagedVenue[]>(venuesKey, (current = []) => current.map((item) => (item.id === venue.id ? venue : item)));
  const add = useMutation({
    mutationFn: (input: FieldClosureInput) => adminClient.addFieldClosure(field.id, input),
    onSuccess: ({ data }) => {
      store(data.venue);
      cache.setQueryData(clashesKey, data.clashes);
      setReason('');
    },
  });
  const remove = useMutation({
    mutationFn: (closureId: string) => adminClient.removeFieldClosure(field.id, closureId, removeReason),
    onSuccess: ({ data }) => {
      store(data);
      void cache.invalidateQueries({ queryKey: clashesKey });
      setRemoveReason('');
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate(
      kind === 'WEEKLY'
        ? { kind, dayOfWeek: day, startMinute: minuteOf(from), endMinute: to === '00:00' ? 1440 : minuteOf(to), startsOn, ...(endsOn ? { endsOn } : {}), reason }
        : { kind, startsAt: new Date(oneOffStart).toISOString(), endsAt: new Date(oneOffEnd).toISOString(), reason },
    );
  };
  return (
    <div className="stack inset">
      <p className="muted">Closures take effect straight away: closed times are not offered or bookable. The venue stays live. The reason is for admins only.</p>
      {field.closures.map((closure) => (
        <div className="row between" key={closure.id}>
          <span><strong>Closed</strong> · {describe(closure)} · {closure.reason}</span>
          <button className="danger small" disabled={remove.isPending || removeReason.trim().length < 3} onClick={() => remove.mutate(closure.id)}>Remove</button>
        </div>
      ))}
      {field.closures.length > 0 && <label>Reason for removing a closure<input value={removeReason} onChange={(event) => setRemoveReason(event.target.value)} /></label>}
      <AdminActionError error={remove.error} onVerified={() => remove.reset()} />
      <form className="form-grid three" onSubmit={submit}>
        <label>Closure type<select value={kind} onChange={(event) => setKind(event.target.value as 'WEEKLY' | 'ONE_OFF')}><option value="WEEKLY">Every week</option><option value="ONE_OFF">One-off</option></select></label>
        {kind === 'WEEKLY' ? (
          <>
            <label>Day<select value={day} onChange={(event) => setDay(Number(event.target.value))}>{days.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label>
            <label>From<input type="time" value={from} onChange={(event) => setFrom(event.target.value)} required /></label>
            <label>To<input type="time" value={to} onChange={(event) => setTo(event.target.value)} required /></label>
            <label>Starts on<input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} required /></label>
            <label>Ends on (optional)<input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label>
          </>
        ) : (
          <>
            <label>Closed from<input type="datetime-local" value={oneOffStart} onChange={(event) => setOneOffStart(event.target.value)} required /></label>
            <label>Closed until<input type="datetime-local" value={oneOffEnd} onChange={(event) => setOneOffEnd(event.target.value)} required /></label>
          </>
        )}
        <label>Internal reason<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Club training" required minLength={3} /></label>
        <button disabled={add.isPending || reason.trim().length < 3}>Add closure</button>
      </form>
      <AdminActionError error={add.error} onVerified={() => add.reset()} />
      <ClashList clashes={clashes.data ?? []} />
    </div>
  );
}

function ClashList({ clashes }: { clashes: FieldClosureClash[] }) {
  if (!clashes.length) return null;
  return (
    <div className="pending-change" data-testid="closure-clashes">
      <strong>{clashes.length === 1 ? '1 booked match clashes' : `${clashes.length} booked matches clash`} with a closure</strong>
      <span className="muted">Nothing has been cancelled. Open a match to cancel it (weather/venue) if it cannot go ahead; players are refunded in full.</span>
      {clashes.map((clash) => (
        <div className="row between" key={clash.matchId}>
          <span>{clash.matchName} · {new Date(clash.startsAt).toLocaleString()} · {clash.status.toLowerCase()}</span>
          <Link to={`/matches/${clash.matchId}`}>Open match</Link>
        </div>
      ))}
    </div>
  );
}
