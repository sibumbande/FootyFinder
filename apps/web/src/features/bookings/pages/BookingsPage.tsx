import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { bookingsClient } from '@/api/client.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { formatRands } from '@/utils/format-currency.js';

const rootKey = ['bookings'] as const;

export function BookingsPage() {
  const { bookingId } = useParams();
  const cache = useQueryClient();
  const [amount, setAmount] = useState('');
  const list = useQuery({
    queryKey: [...rootKey, 'mine'],
    queryFn: async () => (await bookingsClient.list()).data,
  });
  const detail = useQuery({
    queryKey: [...rootKey, bookingId],
    queryFn: async () => (await bookingsClient.get(bookingId!)).data,
    enabled: Boolean(bookingId),
    refetchInterval: bookingId ? 10_000 : false,
  });
  const contribute = useMutation({
    mutationFn: () =>
      bookingsClient.contribute(
        bookingId!,
        { amountCents: Math.round(Number(amount) * 100) },
        crypto.randomUUID(),
      ),
    onSuccess: ({ data }) => {
      cache.setQueryData([...rootKey, bookingId], data);
      void cache.invalidateQueries({ queryKey: [...rootKey, 'mine'] });
      setAmount('');
    },
  });
  const deadline = detail.data?.fundingDeadline
    ? Math.max(0, Date.parse(detail.data.fundingDeadline) - Date.now())
    : 0;

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
            <h2 className="text-xl font-bold text-content-strong">
              Choose an available venue slot
            </h2>
            <p className="text-sm text-content-muted">
              New player bookings start from an approved venue calendar. This keeps the displayed
              price, local time, availability and turnaround buffer consistent with the server.
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
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Snapshot label="Price snapshot" value={formatRands(detail.data.priceCents)} />
                <Snapshot label="Funded" value={formatRands(detail.data.fundedCents)} />
                <Snapshot label="Remaining" value={formatRands(detail.data.remainingCents)} />
              </div>
              {detail.data.status === 'FUNDING' && (
                <>
                  <p className="rounded-xl bg-warning-50 p-3 text-sm text-content">
                    Funding closes in approximately {Math.ceil(deadline / 60_000)} minutes. Funds
                    are held, not debited, until the pool reaches the exact price.
                  </p>
                  <form
                    className="flex flex-wrap items-end gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      contribute.mutate();
                    }}
                  >
                    <Input
                      label="Contribution (R)"
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={(detail.data.remainingCents / 100).toFixed(2)}
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      required
                    />
                    <Button loading={contribute.isPending}>Fund booking</Button>
                  </form>
                </>
              )}
              {contribute.error && <p className="text-danger-600">{contribute.error.message}</p>}
              <div className="space-y-2">
                <h3 className="font-bold text-content-strong">Funding pool</h3>
                {detail.data.contributions.map((item) => (
                  <div
                    className="flex justify-between rounded-xl bg-surface-raised p-3"
                    key={item.id}
                  >
                    <span>{item.user.displayName}</span>
                    <strong>
                      {formatRands(item.amountCents)} · {item.status}
                    </strong>
                  </div>
                ))}
              </div>
              {detail.data.status === 'CONFIRMED' && (
                <Link
                  to={`/matches/${detail.data.match.id}`}
                  className="inline-block rounded-xl bg-brand-600 px-4 py-3 font-bold text-white"
                >
                  Open confirmed Match lobby
                </Link>
              )}
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

function Snapshot({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-raised p-4">
      <span className="text-xs text-content-muted">{label}</span>
      <strong className="block text-lg text-content-strong">{value}</strong>
    </div>
  );
}
