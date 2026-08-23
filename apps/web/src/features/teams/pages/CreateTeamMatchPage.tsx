import {
  DEFAULT_SUBSTITUTE_CAPACITY_PER_TEAM,
  FORMATION_PRESETS,
  MATCH_FORMAT_CONFIG,
  MATCH_FORMATS,
  MATCH_RULE_CONFIG,
  MATCH_RULES,
  MAX_SUBSTITUTES_PER_TEAM,
  type MatchFormat,
  type MatchRule,
} from '@footy-finder/shared';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { AVAILABLE_FIELDS, BOOKING_TIMES } from '@/features/matches/constants/fields.js';
import { useCreateTeamMatch, useTeam } from '../hooks/useTeams.js';

const steps = ['Format & rules', 'Fixture details', 'Venue & kickoff', 'Review'];

export function CreateTeamMatchPage() {
  const { teamId = '' } = useParams();
  const team = useTeam(teamId);
  const creation = useCreateTeamMatch(teamId);
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [format, setFormat] = useState<MatchFormat>('FIVE_A_SIDE');
  const [formationKey, setFormationKey] = useState(FORMATION_PRESETS.FIVE_A_SIDE[0].key);
  const [substitutes, setSubstitutes] = useState(DEFAULT_SUBSTITUTE_CAPACITY_PER_TEAM);
  const [rolling, setRolling] = useState(false);
  const [rules, setRules] = useState<MatchRule[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fieldId, setFieldId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const field = useMemo(() => AVAILABLE_FIELDS.find((item) => item.id === fieldId), [fieldId]);

  if (team.isPending) return <div className="h-[38rem] animate-pulse rounded-3xl bg-surface" />;
  if (!team.data || team.error)
    return <FormError message={team.error?.message ?? 'Team not found.'} />;
  if (!['OWNER', 'CAPTAIN'].includes(team.data.viewerRole ?? ''))
    return (
      <section className="rounded-3xl border border-line bg-surface p-8">
        <FormError message="Only the Team owner or a captain can organise a fixture." />
        <Link className="button mt-4" to={`/teams/${teamId}`}>
          Back to Team
        </Link>
      </section>
    );

  const valid = [
    substitutes >= 0 && substitutes <= MAX_SUBSTITUTES_PER_TEAM,
    name.trim().length >= 3,
    Boolean(field && date && time),
    true,
  ][step];
  const changeFormat = (next: MatchFormat) => {
    setFormat(next);
    setFormationKey(FORMATION_PRESETS[next][0].key);
  };
  const submit = () => {
    if (!field || !date || !time) return;
    creation.mutate(
      {
        name,
        description,
        format,
        formationKey,
        substituteCapacityPerTeam: substitutes,
        rollingSubstitutes: rolling,
        rules,
        startsAt: new Date(`${date}T${time}:00`).toISOString(),
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
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-brand-600">
          {team.data.name}
        </p>
        <h1 className="mt-2 text-3xl font-black text-content-strong">
          Organise a private Team Match
        </h1>
        <p className="mt-2 text-content-muted">
          Create a free Match-Day workspace for availability and lineup planning.
        </p>
      </header>
      <div>
        <div className="mb-3 flex justify-between text-xs font-bold uppercase text-content-muted">
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
          <div className="grid gap-6">
            <h2 className="text-xl font-bold text-content-strong">Choose the Match shape</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {MATCH_FORMATS.map((item) => (
                <Choice key={item} selected={format === item} onClick={() => changeFormat(item)}>
                  <strong>{MATCH_FORMAT_CONFIG[item].shortLabel}</strong>
                  <span className="block text-sm text-content-muted">
                    {MATCH_FORMAT_CONFIG[item].label}
                  </span>
                </Choice>
              ))}
            </div>
            <label className="grid gap-2 text-sm font-semibold text-content">
              Formation preset
              <select
                className="min-h-11 rounded-xl border border-line-strong bg-surface px-3"
                value={formationKey}
                onChange={(event) => setFormationKey(event.target.value)}
              >
                {FORMATION_PRESETS[format].map((preset) => (
                  <option key={preset.key} value={preset.key}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <Input
              label="Substitutes per Team"
              type="number"
              min="0"
              max={MAX_SUBSTITUTES_PER_TEAM}
              value={substitutes}
              onChange={(event) => setSubstitutes(Number(event.target.value))}
            />
            <label className="flex items-center gap-3 text-sm font-semibold text-content">
              <input
                type="checkbox"
                checked={rolling}
                onChange={(event) => setRolling(event.target.checked)}
              />
              Rolling substitutes
            </label>
            <div className="grid gap-2">
              {MATCH_RULES.map((rule) => (
                <label
                  key={rule}
                  className="flex items-center gap-3 rounded-xl border border-line p-3 text-sm"
                >
                  <input
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
                  {MATCH_RULE_CONFIG[rule].label}
                </label>
              ))}
            </div>
          </div>
        )}
        {step === 1 && (
          <div className="grid gap-5">
            <h2 className="text-xl font-bold text-content-strong">Fixture details</h2>
            <Input
              label="Match name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <label className="grid gap-2 text-sm font-semibold text-content">
              Description
              <textarea
                className="min-h-28 rounded-xl border border-line-strong bg-surface p-3"
                maxLength={1000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          </div>
        )}
        {step === 2 && (
          <div className="grid gap-6">
            <h2 className="text-xl font-bold text-content-strong">Book the planning slot</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {AVAILABLE_FIELDS.map((item) => (
                <Choice
                  key={item.id}
                  selected={fieldId === item.id}
                  onClick={() => setFieldId(item.id)}
                >
                  <strong>{item.name}</strong>
                  <span className="mt-2 block text-sm text-content-muted">{item.address}</span>
                </Choice>
              ))}
            </div>
            <Input
              label="Match date"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {BOOKING_TIMES.map((item) => (
                <Choice key={item} selected={time === item} onClick={() => setTime(item)}>
                  {item}
                </Choice>
              ))}
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="grid gap-5">
            <h2 className="text-xl font-bold text-content-strong">Review the Team fixture</h2>
            <dl className="grid gap-4 rounded-2xl bg-surface-muted p-5 sm:grid-cols-2">
              <Summary label="Fixture" value={name} />
              <Summary label="Format" value={MATCH_FORMAT_CONFIG[format].label} />
              <Summary
                label="Formation"
                value={
                  FORMATION_PRESETS[format].find((item) => item.key === formationKey)?.label ??
                  formationKey
                }
              />
              <Summary
                label="Squad"
                value={`${MATCH_FORMAT_CONFIG[format].startersPerTeam} starters + ${substitutes} substitutes`}
              />
              <Summary label="Venue" value={field?.name ?? ''} />
              <Summary label="Kickoff" value={`${date} at ${time}`} />
            </dl>
            <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-700">
              <strong>Private and free.</strong> This creates a HOME-only planning workspace. It
              will not charge a personal or Team wallet and will not create historical Match
              participants.
            </div>
          </div>
        )}
        <FormError message={creation.error?.message} />
        <div className="mt-7 flex justify-between border-t border-line pt-5">
          {step ? (
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
              Organise Match
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition ${selected ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface hover:border-brand-200'}`}
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
