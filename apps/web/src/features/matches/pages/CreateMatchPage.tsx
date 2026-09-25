import {
  DEFAULT_SUBSTITUTE_CAPACITY_PER_TEAM,
  DEFAULT_QUICK_GAME_FEE_CENTS,
  getMaxMatchParticipants,
  MATCH_FORMAT_CONFIG,
  MATCH_FORMATS,
  MATCH_RULE_CONFIG,
  MATCH_RULES,
  MAX_SUBSTITUTES_PER_TEAM,
  MAX_QUICK_GAME_FEE_CENTS,
  type MatchFormat,
  type MatchRule,
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
const steps = [
  'Format',
  'Squad rules',
  'Visibility',
  'Details',
  'Venue',
  'Schedule & fee',
  'Review',
];
export function CreateMatchPage() {
  const [step, setStep] = useState(0);
  const [format, setFormat] = useState<MatchFormat>('FIVE_A_SIDE');
  const [substituteCapacityPerTeam, setSubstituteCapacityPerTeam] = useState(
    DEFAULT_SUBSTITUTE_CAPACITY_PER_TEAM,
  );
  const [rollingSubstitutes, setRollingSubstitutes] = useState(false);
  const [rules, setRules] = useState<MatchRule[]>([]);
  const [visibility, setVisibility] = useState<MatchVisibility>('PUBLIC');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fieldId, setFieldId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [feeRands, setFeeRands] = useState(String(DEFAULT_QUICK_GAME_FEE_CENTS / 100));
  const navigate = useNavigate();
  const creation = useCreateMatch();
  const field = useMemo(() => AVAILABLE_FIELDS.find((item) => item.id === fieldId), [fieldId]);
  const config = MATCH_FORMAT_CONFIG[format];
  const feeValue = Number(feeRands);
  const feeIsValid =
    feeRands.trim() !== '' &&
    Number.isInteger(feeValue) &&
    feeValue >= 0 &&
    feeValue <= MAX_QUICK_GAME_FEE_CENTS / 100;
  const valid = [
    true,
    substituteCapacityPerTeam >= 0 && substituteCapacityPerTeam <= MAX_SUBSTITUTES_PER_TEAM,
    true,
    name.trim().length >= 3,
    Boolean(field),
    Boolean(date && time && feeIsValid),
    true,
  ][step];
  const submit = () => {
    if (!field || !date || !time || !valid) return;
    creation.mutate(
      {
        name,
        description,
        format,
        substituteCapacityPerTeam,
        rollingSubstitutes,
        rules,
        visibility,
        startsAt: new Date(`${date}T${time}:00`).toISOString(),
        feeCents: feeValue * 100,
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
        <p className="anime-kicker">Create a match</p>
        <h1 className="mt-3 text-4xl font-black uppercase leading-none text-content-strong">
          Build your next football lobby.
        </h1>
        <p className="mt-2 text-content-muted">
          Choose the format, squad rules, privacy, venue, schedule and player entry fee.
        </p>
      </div>
      <div>
        <div className="mb-3 flex justify-between text-xs font-bold uppercase tracking-wide text-content-muted">
          <span>
            Step {step + 1} of {steps.length}
          </span>
          <span>{steps[step]}</span>
        </div>
        <div className="h-3 -skew-x-12 overflow-hidden rounded-sm border border-line-strong bg-line">
          <div
            className="h-full bg-danger-600 shadow-[inset_0_-3px_0_rgb(var(--theme-accent-gold)/0.5)] transition-all"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>
      <div className="anime-panel p-5 sm:p-8">
        {step === 0 && (
          <Step
            title="Choose a match format"
            detail="Format controls the starter count and formation slots."
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
                      {option.startersPerTeam} starters per team
                    </span>
                    <span className="mt-1 block text-sm font-bold text-brand-700">
                      Up to {MAX_SUBSTITUTES_PER_TEAM} substitutes per team
                    </span>
                  </Choice>
                );
              })}
            </div>
          </Step>
        )}
        {step === 1 && (
          <Step
            title="Configure the squads"
            detail="Choose how much room each team has beyond its starting lineup."
          >
            <Input
              label="Substitutes per team"
              type="number"
              min="0"
              max={MAX_SUBSTITUTES_PER_TEAM}
              step="1"
              value={substituteCapacityPerTeam}
              onChange={(event) => setSubstituteCapacityPerTeam(Number(event.target.value))}
              hint={`Choose 0–${MAX_SUBSTITUTES_PER_TEAM}. This match can hold ${getMaxMatchParticipants(format, substituteCapacityPerTeam)} players in total.`}
            />
            <label className="flex cursor-pointer gap-3 rounded-2xl border border-line bg-surface-muted p-4">
              <input
                className="mt-1 h-4 w-4 accent-brand-600"
                type="checkbox"
                checked={rollingSubstitutes}
                onChange={(event) => setRollingSubstitutes(event.target.checked)}
              />
              <span>
                <strong className="block text-content-strong">Rolling substitutions</strong>
                <span className="mt-1 block text-sm text-content-muted">
                  Players may rotate on and off during the match.
                </span>
              </span>
            </label>
            <div>
              <p className="mb-2 text-sm font-semibold text-content">Informational rules</p>
              {MATCH_RULES.map((rule) => (
                <label
                  key={rule}
                  className="flex cursor-pointer gap-3 rounded-2xl border border-line bg-surface-muted p-4"
                >
                  <input
                    className="mt-1 h-4 w-4 accent-brand-600"
                    type="checkbox"
                    checked={rules.includes(rule)}
                    onChange={(event) =>
                      setRules((current) =>
                        event.target.checked
                          ? [...current, rule]
                          : current.filter((item) => item !== rule),
                      )
                    }
                  />
                  <span>
                    <strong className="block text-content-strong">
                      {MATCH_RULE_CONFIG[rule].label}
                    </strong>
                    <span className="mt-1 block text-sm text-content-muted">
                      {MATCH_RULE_CONFIG[rule].description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </Step>
        )}
        {step === 2 && (
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
        {step === 3 && (
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
        {step === 4 && (
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
        {step === 5 && (
          <Step
            title="Schedule and player fee"
            detail="Every match lasts 60 minutes. Players pay only when they join a team."
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
              max={MAX_QUICK_GAME_FEE_CENTS / 100}
              step="1"
              value={feeRands}
              onChange={(event) => setFeeRands(event.target.value)}
              error={
                feeRands.length > 0 && !feeIsValid
                  ? 'Use a whole-rand amount from R0 to R500.'
                  : undefined
              }
              hint="Choose a whole-rand amount from R0 to R500. The default is R80."
            />
          </Step>
        )}
        {step === 6 && (
          <Step
            title="Review your match"
            detail="Format and visibility become immutable when you create the match."
          >
            <dl className="grid gap-4 rounded-2xl bg-surface-muted p-5 sm:grid-cols-2">
              <Summary label="Match" value={name} />
              <Summary
                label="Format"
                value={`${config.shortLabel} · ${getMaxMatchParticipants(format, substituteCapacityPerTeam)} players`}
              />
              <Summary
                label="Squads"
                value={`${config.startersPerTeam} starters + ${substituteCapacityPerTeam} substitutes per team`}
              />
              <Summary label="Substitutions" value={rollingSubstitutes ? 'Rolling' : 'Standard'} />
              <Summary
                label="Rules"
                value={
                  rules.length
                    ? rules.map((rule) => MATCH_RULE_CONFIG[rule].label).join(', ')
                    : 'No additional rules'
                }
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
