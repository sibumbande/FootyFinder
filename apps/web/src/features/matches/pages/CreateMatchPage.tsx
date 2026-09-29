import {
  DEFAULT_SUBSTITUTE_CAPACITY_PER_TEAM,
  getMaxMatchParticipants,
  MATCH_FORMAT_CONFIG,
  MATCH_FORMATS,
  MATCH_RULE_CONFIG,
  MATCH_RULES,
  MAX_SUBSTITUTES_PER_TEAM,
  MATCH_FEE_CENTS,
  type MatchFormat,
  type MatchRule,
  type MatchVisibility,
} from '@footy-finder/shared';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { formatRands } from '@/utils/format-currency.js';
import { useCreateMatch } from '../hooks/useMatches.js';
import { useVenue } from '@/features/venues/hooks/useVenues.js';
const steps = [
  'Format',
  'Squad rules',
  'Visibility',
  'Details',
  'Venue',
  'Schedule',
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
  const [search] = useSearchParams();
  const venueSlug = search.get('venue') ?? '';
  const fieldId = search.get('field') ?? '';
  const startsAt = search.get('startsAt') ?? '';
  const selectedFormat = search.get('format') as MatchFormat | null;
  const venueQuery = useVenue(venueSlug);
  const selectedField = venueQuery.data?.venue.fields.find((item) => item.id === fieldId);
  const navigate = useNavigate();
  const creation = useCreateMatch();
  const config = MATCH_FORMAT_CONFIG[format];
  const valid = [
    true,
    substituteCapacityPerTeam >= 0 && substituteCapacityPerTeam <= MAX_SUBSTITUTES_PER_TEAM,
    true,
    name.trim().length >= 3,
    Boolean(selectedField && startsAt && selectedFormat === format),
    Boolean(startsAt),
    true,
  ][step];
  const submit = () => {
    if (!selectedField || !startsAt || !valid) return;
    creation.mutate(
      {
        name,
        description,
        format,
        substituteCapacityPerTeam,
        rollingSubstitutes,
        rules,
        visibility,
        startsAt,
        managedFieldId: selectedField.id,
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
          Choose the format, squad rules, privacy, venue and schedule. Every player pays a fixed R80 to join.
        </p>
      </div>
      {(!selectedField || !startsAt) && <div className="rounded-2xl border border-warning-300 bg-warning-50 p-5"><strong className="text-content-strong">Select a live venue slot first.</strong><p className="mt-2 text-sm text-content-muted">Quick Matches can only be created from the managed venue calendar.</p><Link className="mt-3 inline-block font-bold text-brand-700 underline" to="/#venues">Browse venues</Link></div>}
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
            detail="The approved venue and server-calculated slot are carried from the venue calendar."
          >
            {selectedField ? <div className="rounded-2xl border border-brand-300 bg-brand-50 p-5"><strong className="text-content-strong">{venueQuery.data?.venue.name} — {selectedField.name}</strong><span className="mt-2 block text-sm text-content-muted">{venueQuery.data?.venue.addressLine1}</span></div> : <Link className="font-bold text-brand-700 underline" to="/#venues">Choose a venue and slot</Link>}
          </Step>
        )}
        {step === 5 && (
          <Step
            title="Schedule"
            detail="Every match lasts 60 minutes. Players pay only when they join a team."
          >
            <div className="rounded-2xl bg-surface-muted p-4"><span className="text-xs font-bold uppercase text-content-muted">Selected kickoff</span><strong className="mt-1 block text-content-strong">{startsAt ? new Date(startsAt).toLocaleString() : 'Choose a venue slot'}</strong></div>
            <p data-testid="fixed-fee-notice" className="rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm font-semibold text-brand-700">
              Every player pays {formatRands(MATCH_FEE_CENTS)} to join, including subs. The fee is set by Footy Finder.
            </p>
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
              <Summary label="Venue" value={`${venueQuery.data?.venue.name ?? ''} — ${selectedField?.name ?? ''}`} />
              <Summary label="Kickoff" value={startsAt ? new Date(startsAt).toLocaleString() : ''} />
              <Summary label="Player fee" value={`${formatRands(MATCH_FEE_CENTS)} per player (fixed)`} />
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
            <Button disabled={!selectedField || !startsAt} loading={creation.isPending} onClick={submit}>
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
