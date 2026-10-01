import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { adminClient } from './api.js';
import { AdminActionError } from './FreshMfa.js';

const when = (iso: string) => new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * CEO touch-up batch 3.5, item 4: who is waiting for FootyFinder in each city. The CSV holds only people still
 * subscribed; downloading it needs a fresh authenticator check and is written to the audit log.
 */
export function WaitingListPage() {
  const [cityId, setCityId] = useState('');
  const [subscribed, setSubscribed] = useState<'all' | 'yes' | 'no'>('all');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['admin', 'waiting-list', cityId, subscribed, page],
    queryFn: async () => (await adminClient.waitingList({ cityId: cityId || undefined, subscribed, page })).data,
  });
  const download = useMutation({
    mutationFn: () => adminClient.downloadWaitingList(cityId || undefined),
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement('a'), { href: url, download: filename });
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const cityName = data?.cities.find((city) => city.cityId === cityId)?.name;
  return (
    <section>
      <div className="stack compact-gap">
        <p className="eyebrow">Growth</p>
        <h2>Waiting list</h2>
        <p className="muted">People who asked to hear when FootyFinder opens in their city. Removed entries are never shown.</p>
      </div>
      {list.error && <p className="error">{list.error.message}</p>}
      {data && (
        <>
          <div className="module-grid metrics-grid" aria-label="Subscribed per city">
            <article>
              <span>All cities</span>
              <strong className="metric-value" data-testid="waiting-list-total">{data.totalSubscribed}</strong>
              <small>subscribed</small>
            </article>
            {data.cities.map((city) => (
              <article key={city.cityId}>
                <span>{city.name}</span>
                <strong className="metric-value">{city.subscribed}</strong>
                <small>subscribed · {city.unsubscribed} unsubscribed{city.supportStatus === 'ACTIVE' ? ' · live city' : ''}</small>
              </article>
            ))}
          </div>
          <div className="row">
            <label>
              City
              <select value={cityId} onChange={(event) => { setCityId(event.target.value); setPage(1); }}>
                <option value="">All cities</option>
                {data.cities.map((city) => <option key={city.cityId} value={city.cityId}>{city.name}</option>)}
              </select>
            </label>
            <label>
              Subscribed
              <select value={subscribed} onChange={(event) => { setSubscribed(event.target.value as typeof subscribed); setPage(1); }}>
                <option value="all">Everyone</option>
                <option value="yes">Still subscribed</option>
                <option value="no">Unsubscribed</option>
              </select>
            </label>
            <button type="button" disabled={download.isPending} onClick={() => download.mutate()}>
              {download.isPending ? 'Preparing…' : `Download CSV (${cityName ?? 'all cities'})`}
            </button>
          </div>
          <p className="muted">The CSV holds subscribed people only (email, city, sign-up date, source). Each download is recorded in the audit log.</p>
          <AdminActionError error={download.error} onVerified={() => download.reset()} />
          {download.isSuccess && <p className="muted">Downloaded.</p>}
          {data.entries.length === 0 ? (
            <p className="empty">Nobody here yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th scope="col">Email</th><th scope="col">City</th><th scope="col">Signed up</th><th scope="col">Still subscribed</th></tr>
                </thead>
                <tbody>
                  {data.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.email}</td>
                      <td>{entry.cityName}</td>
                      <td>{when(entry.signedUpAt)}</td>
                      <td>{entry.subscribed ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="row">
              <button type="button" className="ghost small" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
              <span className="muted">Page {page} of {pages} · {data.total} entries</span>
              <button type="button" className="ghost small" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
