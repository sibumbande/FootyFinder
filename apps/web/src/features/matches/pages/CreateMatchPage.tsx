import {
  MATCH_FORMAT_CONFIG,
  MATCH_FORMATS,
  type MatchFormat,
  type MatchVisibility,
} from '@footy-finder/shared';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { formatRands } from '@/utils/format-currency.js';
import { AVAILABLE_FIELDS, BOOKING_TIMES } from '../constants/fields.js';
import { useCreateMatch } from '../hooks/useMatches.js';
const steps = ['Format', 'Visibility', 'Details', 'Venue', 'Schedule & fee', 'Review'];
export function CreateMatchPage() {
  const [step, setStep] = useState(0);
  const [format, setFormat] = useState<MatchFormat>('FIVE_A_SIDE');
  const [visibility, setVisibility] = useState<MatchVisibility>('PUBLIC');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fieldId, setFieldId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [feeRands, setFeeRands] = useState('80');
  const navigate = useNavigate();
  const creation = useCreateMatch();
  const field = useMemo(() => AVAILABLE_FIELDS.find((item) => item.id === fieldId), [fieldId]);
  const config = MATCH_FORMAT_CONFIG[format];
  const valid = [
    true,
    true,
    name.trim().length >= 3,
    Boolean(field),
    Boolean(date && time && Number(feeRands) >= 0),
    true,
  ][step];
  const submit = () => {
    if (!field || !date || !time || !valid) return;
    creation.mutate(
      {
        name,
        description,
        format,
        visibility,
        startsAt: new Date(`${date}T${time}:00`).toISOString(),
        feeCents: Math.round(Number(feeRands) * 100),
        venue: {
          name: field.name,
          addressLine1: field.address,
          city: field.city,
          region: field.region,
          countryCode: field.countryCode,
        },
      },
      { onSuccess: ({ data }) => navigate(`/matches/${data.id}`, { replace: true }) },
    );
  };
  return (
    <section className="mx-auto grid max-w-5xl gap-7">
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-brand-600">
          Create a match
        </p>
        <h1 className="mt-2 text-3xl font-bold text-content-strong">
          Build your next football lobby.
        </h1>
        <p className="mt-2 text-content-muted">
          Choose the format, privacy, venue, schedule and player entry fee.
        </p>
      </div>
      <div>
        <div className="mb-3 flex justify-between text-xs font-bold uppercase tracking-wide text-content-muted">
          <span>
            Step {step + 1} of {steps.length}
          </span>
          <span>{steps[step]}</span>
        </div>
        <div className="h-2 rounded-full bg-line">
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>
      <div className="rounded-3xl border border-line bg-surface p-5 shadow-soft sm:p-8">
        {step === 0 && (
          <Step
            title="Choose a match format"
            detail="Format controls the pitch, team capacity and reserves."
          >
            <div className="grid gap-4 md:grid-cols-3">
              {MATCH_FORMATS.map((item) => {
                const option = MATCH_FORMAT_CONFIG[item];
                return (
                  <Choice key={item} selected={format === item} onClick={() => setFormat(item)}>
                    <span className="text-2xl font-black text-content-strong">
                      {option.shortLabel}
                    </span>
                    <span className="mt-1 block font-semibold text-content">{option.label}</span>
                    <span className="mt-3 block text-sm text-content-muted">
                      {option.playersPerTeam} starters + {option.reservesPerTeam} reserves per team
                    </span>
                    <span className="mt-1 block text-sm font-bold text-brand-700">
                      {option.maxParticipants} total players
                    </span>
                  </Choice>
                );
              })}
            </div>
          </Step>
        )}
        {step === 1 && (
          <Step
            title="Who can discover this match?"
            detail="Visibility cannot be changed after creation."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Choice selected={visibility === 'PUBLIC'} onClick={() => setVisibility('PUBLIC')}>
                <strong className="text-lg text-content-strong">Public</strong>
                <span className="mt-2 block text-sm text-content-muted">
                  Appears in match discovery and can be joined by eligible players.
                </span>
              </Choice>
              <Choice selected={visibility === 'PRIVATE'} onClick={() => setVisibility('PRIVATE')}>
                <strong className="text-lg text-content-strong">Private</strong>
                <span className="mt-2 block text-sm text-content-muted">
                  Hidden from discovery. You receive a secure invitation link.
                </span>
              </Choice>
            </div>
          </Step>
        )}
        {step === 2 && (
          <Step title="Match details" detail="Give players a clear idea of the game.">
            <Input
              label="Match name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              error={
                name.length > 0 && name.trim().length < 3 ? 'Use at least 3 characters.' : undefined
              }
            />
            <label className="grid gap-2 text-sm font-semibold text-content">
              Description
              <textarea
                className="min-h-28 rounded-xl border border-line-strong bg-surface px-3.5 py-3 font-normal text-content-strong"
                maxLength={1000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          </Step>
        )}
        {step === 3 && (
          <Step
            title="Select a venue"
            detail="These development venues will later come from the venue catalogue."
          >
            <div className="grid gap-4 md:grid-cols-3">
              {AVAILABLE_FIELDS.map((item) => (
                <Choice
                  key={item.id}
                  selected={fieldId === item.id}
                  onClick={() => setFieldId(item.id)}
                >
                  <strong className="text-content-strong">{item.name}</strong>
                  <span className="mt-1 block text-xs font-bold text-brand-700">
                    {item.surface}
                  </span>
                  <span className="mt-3 block text-sm text-content-muted">{item.address}</span>
                </Choice>
              ))}
            </div>
          </Step>
        )}
        {step === 4 && (
          <Step
            title="Schedule and player fee"
            detail="The saved duration is configured by format. Players pay only when they join a team."
          >
            <Input
              label="Match date"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <div>
              <p className="mb-2 text-sm font-semibold text-content">Kickoff</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {BOOKING_TIMES.map((slot) => (
                  <Choice compact key={slot} selected={time === slot} onClick={() => setTime(slot)}>
                    {slot}
                  </Choice>
                ))}
              </div>
            </div>
            <Input
              label="Entry fee (rands)"
              type="number"
              min="0"
              step="1"
              value={feeRands}
              onChange={(event) => setFeeRands(event.target.value)}
              hint="Set this to R0 for a free match."
            />
          </Step>
        )}
        {step === 5 && (
          <Step
            title="Review your match"
            detail="Format and visibility become immutable when you create the match."
          >
            <dl className="grid gap-4 rounded-2xl bg-surface-muted p-5 sm:grid-cols-2">
              <Summary label="Match" value={name} />
              <Summary
                label="Format"
                value={`${config.shortLabel} · ${config.maxParticipants} players`}
              />
              <Summary
                label="Visibility"
                value={visibility === 'PRIVATE' ? 'Private invitation' : 'Public discovery'}
              />
              <Summary label="Venue" value={field?.name ?? ''} />
              <Summary label="Kickoff" value={`${date} at ${time}`} />
              <Summary label="Player fee" value={formatRands(Math.round(Number(feeRands) * 100))} />
            </dl>
            <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-700">
              <strong>You remain host-only after creation.</strong> Hosting does not consume
              capacity or charge your wallet. Join Home or Away from the lobby if you also want to
              play.
            </div>
          </Step>
        )}
        <FormError message={creation.error?.message} />
        <div className="mt-7 flex justify-between border-t border-line pt-5">
          {step > 0 ? (
            <Button variant="secondary" onClick={() => setStep((value) => value - 1)}>
              Previous
            </Button>
          ) : (
            <span />
          )}
          {step < steps.length - 1 ? (
            <Button disabled={!valid} onClick={() => setStep((value) => value + 1)}>
              Continue
            </Button>
          ) : (
            <Button loading={creation.isPending} onClick={submit}>
              Create match
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
function Step({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-xl font-bold text-content-strong">{title}</h2>
        <p className="mt-1 text-sm text-content-muted">{detail}</p>
      </div>
      {children}
    </div>
  );
}
function Choice({
  selected,
  onClick,
  children,
  compact = false,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border text-left transition focus:outline-none focus:ring-4 focus:ring-brand-100 ${compact ? 'min-h-12 p-3 text-center font-bold' : 'p-5'} ${selected ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface hover:border-brand-200 hover:bg-surface-hover'}`}
    >
      {children}
    </button>
  );
}
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase text-content-muted">{label}</dt>
      <dd className="mt-1 font-semibold text-content-strong">{value}</dd>
    </div>
  );
}
