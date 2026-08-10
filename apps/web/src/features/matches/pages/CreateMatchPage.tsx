import { MATCH_FEE_CENTS } from '@footy-finder/shared';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { formatRands } from '@/utils/format-currency.js';
import { AVAILABLE_FIELDS, BOOKING_TIMES } from '../constants/fields.js';
import { useCreateMatch } from '../hooks/useMatches.js';

const steps = ['Choose field', 'Book a time', 'Match details'];

export function CreateMatchPage() {
  const [step, setStep] = useState(0);
  const [fieldId, setFieldId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const navigate = useNavigate();
  const creation = useCreateMatch();
  const field = useMemo(() => AVAILABLE_FIELDS.find((item) => item.id === fieldId), [fieldId]);
  const canContinue =
    step === 0 ? Boolean(field) : step === 1 ? Boolean(date && time) : name.trim().length >= 3;
  const submit = () => {
    if (!field || !date || !time || name.trim().length < 3) return;
    creation.mutate(
      {
        name,
        description,
        venueName: field.name,
        address: field.address,
        startsAt: new Date(`${date}T${time}:00`).toISOString(),
      },
      { onSuccess: ({ data }) => navigate(`/matches/${data.id}`, { replace: true }) },
    );
  };

  return (
    <section className="mx-auto grid max-w-4xl gap-7">
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-brand-600">
          Create a match
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-content-strong">
          Book the pitch. Build the lobby.
        </h1>
        <p className="mt-2 text-content-muted">
          Choose a field and time, then invite up to 29 more players.
        </p>
      </div>
      <div>
        <div className="mb-3 flex justify-between text-xs font-bold uppercase tracking-wide text-content-muted">
          <span>Step {step + 1} of 3</span>
          <span>{steps[step]}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${((step + 1) / 3) * 100}%` }}
          />
        </div>
      </div>
      <div className="rounded-3xl border border-line bg-surface p-5 shadow-soft sm:p-8">
        {step === 0 && (
          <div className="grid gap-4">
            <div>
              <h2 className="text-xl font-bold text-content-strong">Select an available field</h2>
              <p className="mt-1 text-sm text-content-muted">
                These fields are temporary sample data and will later come from the booking
                database.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {AVAILABLE_FIELDS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFieldId(item.id)}
                  className={`rounded-2xl border p-5 text-left transition focus:outline-none focus:ring-4 focus:ring-brand-100 ${fieldId === item.id ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface hover:border-brand-200 hover:bg-surface-hover'}`}
                >
                  <span className="mb-4 grid size-11 place-items-center rounded-xl bg-brand-100 text-brand-700">
                    <svg
                      viewBox="0 0 24 24"
                      className="size-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M4 19V5h16v14zM4 12h16M12 5v14" />
                      <circle cx="12" cy="12" r="2" />
                    </svg>
                  </span>
                  <span className="block font-bold text-content-strong">{item.name}</span>
                  <span className="mt-1 block text-xs font-semibold text-brand-700">
                    {item.surface}
                  </span>
                  <span className="mt-3 block text-sm leading-6 text-content-muted">
                    {item.description}
                  </span>
                  <span className="mt-3 block text-xs text-content-subtle">{item.address}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {step === 1 && (
          <div className="grid gap-6">
            <div>
              <h2 className="text-xl font-bold text-content-strong">Reserve your kickoff</h2>
              <p className="mt-1 text-sm text-content-muted">
                Select a date and one of the available two-hour booking windows.
              </p>
            </div>
            <Input
              label="Match date"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <div>
              <p className="mb-3 text-sm font-semibold text-content">Available times</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {BOOKING_TIMES.map((slot) => (
                  <button
                    type="button"
                    key={slot}
                    onClick={() => setTime(slot)}
                    className={`min-h-12 rounded-xl border text-sm font-bold transition focus:outline-none focus:ring-4 focus:ring-brand-100 ${time === slot ? 'border-brand-500 bg-brand-600 text-content-inverse' : 'border-line bg-surface text-content hover:bg-surface-hover'}`}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            </div>
            {field && (
              <div className="rounded-2xl bg-surface-muted p-4 text-sm">
                <span className="font-bold text-content-strong">{field.name}</span>
                <span className="ml-2 text-content-muted">· Two-hour booking</span>
              </div>
            )}
          </div>
        )}
        {step === 2 && (
          <div className="grid gap-6">
            <div>
              <h2 className="text-xl font-bold text-content-strong">Name your match</h2>
              <p className="mt-1 text-sm text-content-muted">
                Review the booking and create the persistent 30-player lobby.
              </p>
            </div>
            <Input
              label="Match name"
              placeholder="Saturday evening football"
              value={name}
              onChange={(event) => setName(event.target.value)}
              error={
                name.length > 0 && name.trim().length < 3 ? 'Use at least 3 characters' : undefined
              }
            />
            <label className="grid gap-2 text-sm font-semibold text-content">
              Description{' '}
              <textarea
                className="min-h-28 rounded-xl border border-line-strong bg-surface px-3.5 py-3 font-normal text-content-strong outline-none placeholder:text-content-subtle focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                maxLength={1000}
                placeholder="Add anything players should know…"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <dl className="grid gap-4 rounded-2xl bg-surface-muted p-5 sm:grid-cols-3">
              <Summary label="Field" value={field?.name ?? ''} />
              <Summary
                label="Date"
                value={
                  date
                    ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
                        dateStyle: 'medium',
                      })
                    : ''
                }
              />
              <Summary label="Kickoff" value={time} />
            </dl>
            <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-700">
              <strong>30 player lobby:</strong> 10 starters and 5 reserves on each of two teams. You
              will take the first Home Team starting slot.
              <span className="mt-2 block font-bold">
                Booking fee: {formatRands(MATCH_FEE_CENTS)} will be deducted from your wallet.
              </span>
            </div>
          </div>
        )}
        <FormError message={creation.error instanceof Error ? creation.error.message : undefined} />
        <div className="mt-7 flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-between">
          {step > 0 ? (
            <Button
              variant="secondary"
              onClick={() => setStep((current) => current - 1)}
              disabled={creation.isPending}
            >
              Previous
            </Button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <Button onClick={() => setStep((current) => current + 1)} disabled={!canContinue}>
              Continue
            </Button>
          ) : (
            <Button onClick={submit} disabled={!canContinue} loading={creation.isPending}>
              Create match lobby
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-content-muted">{label}</dt>
      <dd className="mt-1 font-semibold text-content-strong">{value}</dd>
    </div>
  );
}
