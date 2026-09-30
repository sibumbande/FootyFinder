import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { adminClient } from './api.js';
import { AdminActionError } from './FreshMfa.js';

const rootKey = ['admin', 'referees'] as const;

/** Gate 8 / TKT-801 (DEC-020): grant and remove the FootyFinder referee role. */
export function RefereesPage() {
  const cache = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string>();
  const [grantReason, setGrantReason] = useState('');
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const referees = useQuery({ queryKey: rootKey, queryFn: async () => (await adminClient.referees()).data });
  const candidates = useQuery({
    queryKey: [...rootKey, 'candidates', search],
    queryFn: async () => (await adminClient.moderationUsers({ search })).data,
    enabled: search.trim().length >= 2,
  });
  const refresh = () => void cache.invalidateQueries({ queryKey: rootKey });
  const grant = useMutation({
    mutationFn: () => adminClient.grantReferee(selectedUserId!, { reason: grantReason }),
    onSuccess: () => {
      setGrantReason('');
      setSelectedUserId(undefined);
      refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (userId: string) => adminClient.revokeReferee(userId, { reason: revokeReasons[userId] ?? '' }),
    onSuccess: refresh,
  });
  // D28: the default referee is assigned automatically to new matches when they are free.
  const settings = useQuery({ queryKey: [...rootKey, 'settings'], queryFn: async () => (await adminClient.refereeSettings()).data });
  const [defaultRefereeUserId, setDefaultRefereeUserId] = useState<string>();
  const saveDefault = useMutation({
    mutationFn: () => adminClient.updateRefereeSettings({ defaultRefereeUserId: defaultRefereeUserId || null }),
    onSuccess: refresh,
  });
  const refereeIds = new Set(referees.data?.map(({ userId }) => userId));
  const submitGrant = (event: FormEvent) => {
    event.preventDefault();
    grant.mutate();
  };
  return (
    <section>
      <p className="eyebrow">Match officials</p>
      <h2>Referees</h2>
      <p className="muted">
        Every match needs a FootyFinder referee. Referees see the Referee tab in the app, record final results, and see
        player names in the matches they referee. Granting or removing the role needs a reason and a fresh
        authenticator check, and is recorded in the audit log.
      </p>
      <h3>Default referee</h3>
      <p className="muted">
        When a match is published it is given the default referee automatically if they are free at that time.
        Otherwise it goes to Match referees as unassigned and admins are alerted.
      </p>
      <div className="row">
        <label>
          Default referee
          <select
            value={defaultRefereeUserId ?? settings.data?.defaultReferee?.userId ?? ''}
            onChange={(event) => setDefaultRefereeUserId(event.target.value)}
          >
            <option value="">No default referee</option>
            {referees.data?.map((referee) => (
              <option key={referee.userId} value={referee.userId}>
                {referee.displayName}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={defaultRefereeUserId === undefined || saveDefault.isPending}
          onClick={() => saveDefault.mutate()}
        >
          Save default referee
        </button>
      </div>
      {settings.data && (
        <p className="muted">
          Currently: {settings.data.defaultReferee?.displayName ?? 'none'}
          {settings.data.updatedBy ? ` · last changed by ${settings.data.updatedBy.displayName} ${new Date(settings.data.updatedAt).toLocaleString()}` : ''}
        </p>
      )}
      <AdminActionError error={saveDefault.error} onVerified={() => saveDefault.reset()} />
      <h3>Current referees</h3>
      {referees.error && <p className="error">{referees.error.message}</p>}
      {referees.data?.length === 0 && <p className="muted">No referees yet.</p>}
      {referees.data?.map((referee) => (
        <article key={referee.userId} className="venue-card">
          <strong>{referee.displayName}</strong>
          <p className="muted">
            @{referee.username} · {referee.email} · {referee.accountStatus} · referee since{' '}
            {new Date(referee.grantedAt).toLocaleDateString()}
            {referee.grantedBy ? ` · granted by ${referee.grantedBy.displayName}` : ''}
          </p>
          <p>Reason: {referee.grantReason}</p>
          <div className="row">
            <input
              aria-label={`Reason for removing ${referee.displayName}`}
              placeholder="Reason for removing the role"
              value={revokeReasons[referee.userId] ?? ''}
              onChange={(event) => setRevokeReasons({ ...revokeReasons, [referee.userId]: event.target.value })}
            />
            <button
              type="button"
              className="danger"
              disabled={revoke.isPending || (revokeReasons[referee.userId] ?? '').trim().length < 3}
              onClick={() => revoke.mutate(referee.userId)}
            >
              Remove referee
            </button>
          </div>
        </article>
      ))}
      <AdminActionError error={revoke.error} onVerified={() => revoke.reset()} />
      <h3>Make someone a referee</h3>
      <label>
        Find player
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Email, username or display name"
        />
      </label>
      <div className="ticket-list">
        {candidates.data?.map((user) => (
          <button
            key={user.id}
            type="button"
            className={selectedUserId === user.id ? 'ticket active-ticket' : 'ticket'}
            disabled={refereeIds.has(user.id)}
            onClick={() => setSelectedUserId(user.id)}
          >
            <strong>{user.displayName}</strong>
            <span>
              @{user.username} · {user.accountStatus}
              {refereeIds.has(user.id) ? ' · already a referee' : ''}
            </span>
            <small>{user.email}</small>
          </button>
        ))}
      </div>
      {selectedUserId && (
        <form className="row" onSubmit={submitGrant}>
          <label>
            Reason
            <input
              value={grantReason}
              onChange={(event) => setGrantReason(event.target.value)}
              minLength={3}
              maxLength={500}
              required
            />
          </label>
          <button disabled={grant.isPending}>Make referee</button>
        </form>
      )}
      <AdminActionError error={grant.error} onVerified={() => grant.reset()} />
    </section>
  );
}
