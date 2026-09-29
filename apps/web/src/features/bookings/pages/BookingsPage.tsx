import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { bookingsClient } from '@/api/client.js';

const rootKey = ['bookings'] as const;

/**
 * Read-only field booking history. DEC-018: players never fund or see venue costs; new matches
 * are created from a venue slot and every player pays the fixed R80 fee.
 */
export function BookingsPage() {
  const { bookingId } = useParams();
  const list = useQuery({
    queryKey: [...rootKey, 'mine'],
    queryFn: async () => (await bookingsClient.list()).data,
  });
  const detail = useQuery({
    queryKey: [...rootKey, bookingId],
    queryFn: async () => (await bookingsClient.get(bookingId!)).data,
    enabled: Boolean(bookingId),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[19rem_1fr]">
      <aside className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-brand-600">
            Managed fields
          </p>
          <h1 className="text-2xl font-bold text-content-strong">Field bookings</h1>
        </div>
        <Link
          to="/#venues"
          className="block rounded-xl bg-brand-600 p-3 text-center font-bold text-white"
        >
          Browse available slots
        </Link>
        {list.data?.map((item) => (
          <Link
            key={item.id}
            to={`/bookings/${item.id}`}
            className="block rounded-xl border border-line bg-surface-raised p-3"
          >
            <strong className="block text-content-strong">{item.match.name}</strong>
            <span className="text-xs text-content-muted">
              {item.fieldName} · {item.status}
            </span>
          </Link>
        ))}
      </aside>

      {!bookingId ? (
        <section className="space-y-5 rounded-2xl border border-line bg-surface p-6">
          <div>
            <h2 className="text-xl font-bold text-content-strong">Book through a Quick Match</h2>
            <p className="text-sm text-content-muted">
              Pick a slot on a venue calendar to create a Quick Match. Every player pays a fixed
              R80 to join, including subs, and nobody pays the venue up front.
            </p>
          </div>
          <Link
            to="/#venues"
            className="inline-block rounded-xl bg-brand-600 px-4 py-3 font-bold text-white"
          >
            Open venue calendars
          </Link>
        </section>
      ) : (
        <section className="space-y-5 rounded-2xl border border-line bg-surface p-6">
          {detail.isPending && <p>Loading booking…</p>}
          {detail.error && <p className="text-danger-600">{detail.error.message}</p>}
          {detail.data && (
            <>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold text-content-strong">
                    {detail.data.match.name}
                  </h2>
                  <span className="rounded-full bg-brand-50 px-2 py-1 text-xs font-bold text-brand-700">
                    {detail.data.status}
                  </span>
                </div>
                <p className="text-content-muted">
                  {detail.data.venueName} — {detail.data.fieldName}
                </p>
                <p className="text-sm text-content-muted">
                  {new Date(detail.data.startsAt).toLocaleString()}
                </p>
              </div>
              {detail.data.contributions.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-bold text-content-strong">Players involved</h3>
                  {detail.data.contributions.map((item) => (
                    <div
                      className="flex justify-between rounded-xl bg-surface-raised p-3"
                      key={item.id}
                    >
                      <span>{item.user.displayName}</span>
                      <span className="text-xs font-bold text-content-muted">{item.status}</span>
                    </div>
                  ))}
                </div>
              )}
              <Link
                to={`/matches/${detail.data.match.id}`}
                className="inline-block rounded-xl bg-brand-600 px-4 py-3 font-bold text-white"
              >
                Open Match lobby
              </Link>
              <Link
                to={`/disputes/new/FIELD_BOOKING/${detail.data.id}`}
                className="ml-2 inline-block rounded-xl border border-line px-4 py-3 font-bold text-content"
              >
                Dispute booking
              </Link>
            </>
          )}
        </section>
      )}
    </div>
  );
}
