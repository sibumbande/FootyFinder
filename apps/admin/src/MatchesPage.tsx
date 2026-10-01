import { ADMIN_MATCH_NEEDS, ADMIN_MATCH_VIEWS, DEFAULT_SUBSTITUTE_CAPACITY_PER_TEAM, MATCH_FORMAT_CONFIG, MAX_SUBSTITUTES_PER_TEAM, type AdminCreatedMatch, type MatchFormat } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminClient, venuesClient } from './api.js';
import { AdminActionError } from './FreshMfa.js';
import { InviteLink, matchesKey, when } from './MatchActions.js';

type View = (typeof ADMIN_MATCH_VIEWS)[number];
type Needs = (typeof ADMIN_MATCH_NEEDS)[number];
const VIEW_LABEL: Record<View, string> = { upcoming: 'Upcoming', live: 'Live / awaiting result', finished: 'Finished', cancelled: 'Cancelled' };
const NEEDS_LABEL: Record<Needs, string> = { referee: 'Needs a referee', result: 'Needs a result', problem: 'Problem reported' };

/**
 * CEO touch-up batch 3.5, item 5: every match in one place. Search and filter, open a match for all its actions,
 * or create a FootyFinder-hosted match on a real slot.
 */
export function MatchesPage() {
  const [params, setParams] = useSearchParams();
  const view = (ADMIN_MATCH_VIEWS as readonly string[]).includes(params.get('view') ?? '') ? (params.get('view') as View) : 'upcoming';
  const needs = (ADMIN_MATCH_NEEDS as readonly string[]).includes(params.get('needs') ?? '') ? (params.get('needs') as Needs) : undefined;
  const venueId = params.get('venueId') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const q = params.get('q') ?? '';
  const page = Number(params.get('page') ?? '1') || 1;
  const [search, setSearch] = useState(q);
  const [creating, setCreating] = useState(false);
  const set = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };
  const venues = useQuery({ queryKey: ['admin', 'venues'], queryFn: async () => (await adminClient.venues()).data });
  const list = useQuery({
    queryKey: [...matchesKey, 'list', view, needs, venueId, from, to, q, page],
    queryFn: async () => (await adminClient.adminMatches({ view, needs, venueId: venueId || undefined, from: from || undefined, to: to || undefined, q: q || undefined, page })).data,
    refetchInterval: 30_000,
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <section>
      <div className="row between">
        <div className="stack compact-gap">
          <p className="eyebrow">Operations</p>
          <h2>Matches</h2>
        </div>
        <button type="button" onClick={() => setCreating((value) => !value)} aria-expanded={creating}>
          {creating ? 'Close' : 'Create match'}
        </button>
      </div>
      {creating && <CreateMatchForm />}
      <div className="filter-bar" aria-label="Which matches">
        {ADMIN_MATCH_VIEWS.map((item) => (
          <button key={item} type="button" className={view === item && !needs ? 'small' : 'ghost small'} aria-pressed={view === item && !needs} onClick={() => set({ view: item, needs: undefined })}>
            {VIEW_LABEL[item]}
          </button>
        ))}
      </div>
      <div className="filter-bar" aria-label="Work queues">
        {ADMIN_MATCH_NEEDS.map((item) => (
          <button key={item} type="button" className={needs === item ? 'small' : 'ghost small'} aria-pressed={needs === item} onClick={() => set({ needs: needs === item ? undefined : item })}>
            {NEEDS_LABEL[item]}
          </button>
        ))}
      </div>
      <form className="form-grid four" onSubmit={(event) => { event.preventDefault(); set({ q: search.trim() || undefined }); }}>
        <label>
          Search by name
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Match name" />
        </label>
        <label>
          Venue
          <select value={venueId} onChange={(event) => set({ venueId: event.target.value || undefined })}>
            <option value="">All venues</option>
            {venues.data?.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
          </select>
        </label>
        <label>
          From
          <input type="date" value={from} onChange={(event) => set({ from: event.target.value || undefined })} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(event) => set({ to: event.target.value || undefined })} />
        </label>
      </form>
      {list.error && <p className="error">{list.error.message}</p>}
      {data && data.matches.length === 0 && <p className="empty">No matches here.</p>}
      {data && data.matches.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th scope="col">Kick-off</th><th scope="col">Match</th><th scope="col">Venue</th><th scope="col">Players</th><th scope="col">Referee</th><th scope="col">Host</th><th scope="col">Status</th></tr>
            </thead>
            <tbody>
              {data.matches.map((match) => (
                <tr key={match.matchId}>
                  <td>{when(match.startsAt)}</td>
                  <td>
                    <Link to={`/matches/${match.matchId}`}>{match.name}</Link>
                    <div className="muted">
                      {match.mode === 'TEAM_MATCH' ? 'Team match' : 'Quick match'} · {MATCH_FORMAT_CONFIG[match.format].shortLabel} · {match.visibility === 'PRIVATE' ? 'Private' : 'Public'}
                      {match.freeOnFootyFinder ? ` · Free${match.firstTimersOnly ? ', first-timers only' : ''}` : ''}
                    </div>
                  </td>
                  <td>{match.venueName}</td>
                  <td>{match.filled}/{match.capacity}</td>
                  <td>{match.refereeName ?? <span className="error">None</span>}</td>
                  <td>{match.hostName}</td>
                  <td><span className="pill">{match.status.replaceAll('_', ' ').toLowerCase()}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="row">
          <button type="button" className="ghost small" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>Previous</button>
          <span className="muted">Page {page} of {pages} · {data?.total} matches</span>
          <button type="button" className="ghost small" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>Next</button>
        </div>
      )}
    </section>
  );
}

/** Today in South Africa (UTC+2), as YYYY-MM-DD. */
const saToday = () => new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);

/**
 * CEO touch-up batch 3.5, item 5 (D3, D4): FootyFinder hosts the match and the admin does not join. The admin picks a
 * real free slot (the same list players see: availability, closures and existing bookings already applied); the
 * server books it exactly like a player-created match. Fresh MFA and an audit entry.
 */
function CreateMatchForm() {
  const cache = useQueryClient();
  const [venueId, setVenueId] = useState('');
  const [fieldId, setFieldId] = useState('');
  const [format, setFormat] = useState<MatchFormat | ''>('');
  const [day, setDay] = useState(saToday());
  const [startsAt, setStartsAt] = useState('');
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [subs, setSubs] = useState(DEFAULT_SUBSTITUTE_CAPACITY_PER_TEAM);
  const [free, setFree] = useState(false);
  const [firstTimersOnly, setFirstTimersOnly] = useState(false);
  const [created, setCreated] = useState<AdminCreatedMatch>();
  const venues = useQuery({ queryKey: ['admin', 'venues'], queryFn: async () => (await adminClient.venues()).data });
  const bookable = useMemo(() => venues.data?.filter((venue) => venue.isActive && venue.publicationStatus === 'PUBLISHED') ?? [], [venues.data]);
  const venue = bookable.find((item) => item.id === venueId);
  const fields = venue?.fields.filter((item) => item.status === 'ACTIVE') ?? [];
  const field = fields.find((item) => item.id === fieldId);
  const slots = useQuery({
    queryKey: ['admin', 'create-match-slots', venue?.slug, fieldId, format, day],
    queryFn: async () => (await venuesClient.slots(venue!.slug, { fieldId, format: format as MatchFormat, dateFrom: day, dateTo: day })).data,
    enabled: Boolean(venue && fieldId && format && day),
  });
  const earliest = Date.now() + 2 * 3_600_000;
  const open = slots.data?.filter((slot) => new Date(slot.startsAt).getTime() >= earliest) ?? [];
  const create = useMutation({
    mutationFn: () => adminClient.createAdminMatch({
      managedFieldId: fieldId, name, format: format as MatchFormat, visibility, startsAt, substituteCapacityPerTeam: subs, rules: [],
      freeOnFootyFinder: free, firstTimersOnly: free && firstTimersOnly,
    }),
    onSuccess: ({ data }) => {
      setCreated(data);
      setStartsAt('');
      setName('');
      void cache.invalidateQueries({ queryKey: matchesKey });
      void cache.invalidateQueries({ queryKey: ['admin', 'create-match-slots'] });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  return (
    <form className="create-panel stack" onSubmit={submit} aria-label="Create match">
      <h3>Create match (hosted by FootyFinder)</h3>
      <p className="muted">Players see &quot;Hosted by FootyFinder&quot;. You do not join it. It is booked with the venue like any match, so the venue is paid as usual.</p>
      <div className="form-grid three">
        <label>
          Venue
          <select value={venueId} onChange={(event) => { setVenueId(event.target.value); setFieldId(''); setFormat(''); setStartsAt(''); }} required>
            <option value="">Choose a venue</option>
            {bookable.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>
          Field
          <select value={fieldId} onChange={(event) => { setFieldId(event.target.value); setFormat(''); setStartsAt(''); }} required disabled={!venue}>
            <option value="">Choose a field</option>
            {fields.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>
          Format
          <select value={format} onChange={(event) => { setFormat(event.target.value as MatchFormat); setStartsAt(''); }} required disabled={!field}>
            <option value="">Choose a format</option>
            {field?.supportedFormats.map((item) => <option key={item} value={item}>{MATCH_FORMAT_CONFIG[item].label}</option>)}
          </select>
        </label>
        <label>
          Date
          <input type="date" value={day} min={saToday()} onChange={(event) => { setDay(event.target.value); setStartsAt(''); }} required />
        </label>
        <label>
          Slot
          <select value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required disabled={!format}>
            <option value="">{slots.isFetching ? 'Loading slots…' : open.length ? 'Choose a slot' : 'No free slots'}</option>
            {open.map((slot) => <option key={slot.startsAt} value={slot.startsAt}>{slot.localTime} ({slot.localDate})</option>)}
          </select>
        </label>
        <label>
          Substitutes per side
          <input type="number" min={0} max={MAX_SUBSTITUTES_PER_TEAM} value={subs} onChange={(event) => setSubs(Number(event.target.value))} />
        </label>
      </div>
      <label>
        Match name
        <input value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={120} required placeholder="e.g. FootyFinder Friday Fives" />
      </label>
      <fieldset>
        <legend>Who can join</legend>
        <label className="check"><input type="radio" name="visibility" checked={visibility === 'PUBLIC'} onChange={() => setVisibility('PUBLIC')} />Public (listed in the app and website)</label>
        <label className="check"><input type="radio" name="visibility" checked={visibility === 'PRIVATE'} onChange={() => setVisibility('PRIVATE')} />Private (invite link only)</label>
      </fieldset>
      <fieldset>
        <legend>Price</legend>
        <label className="check">
          <input type="checkbox" checked={free} onChange={(event) => { setFree(event.target.checked); if (!event.target.checked) setFirstTimersOnly(false); }} />
          Free match (On FootyFinder): players join for R0
        </label>
        <label className="check">
          <input type="checkbox" checked={firstTimersOnly} disabled={!free} onChange={(event) => setFirstTimersOnly(event.target.checked)} />
          First-time players only
        </label>
      </fieldset>
      <button disabled={create.isPending || !startsAt || name.trim().length < 3}>{create.isPending ? 'Creating…' : 'Create match'}</button>
      <AdminActionError error={create.error} onVerified={() => create.reset()} />
      {created && (
        <div className="stack compact-gap" data-testid="created-match">
          <p>
            <strong>Created {created.name}</strong> · {when(created.startsAt)}
            {created.freeOnFootyFinder ? ` · free${created.firstTimersOnly ? ', first-time players only' : ''}` : ' · R80 per player'} ·{' '}
            <Link to={`/matches/${created.matchId}`}>Open the match</Link>
          </p>
          {created.inviteUrl && <InviteLink url={created.inviteUrl} />}
          {created.publicUrl && <p className="muted">Public page: <a href={created.publicUrl} target="_blank" rel="noreferrer">{created.publicUrl}</a></p>}
        </div>
      )}
    </form>
  );
}
