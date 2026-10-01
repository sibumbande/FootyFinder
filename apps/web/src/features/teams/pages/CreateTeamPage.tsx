import {
  FORMATION_PRESETS,
  MATCH_FORMAT_CONFIG,
  MATCH_FORMATS,
  createTeamSchema,
  getDefaultFormationKey,
  type MatchFormat,
} from '@footy-finder/shared';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { TeamAvatar } from '../components/TeamAvatar.js';
import { useCreateTeam } from '../hooks/useTeams.js';

const steps = ['Team identity', 'Football setup', 'Review'];

export function CreateTeamPage() {
  const navigate = useNavigate();
  const creation = useCreateTeam();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [description, setDescription] = useState('');
  const [locationText, setLocationText] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#278A4B');
  const [secondaryColor, setSecondaryColor] = useState('#123522');
  const [format, setFormat] = useState<MatchFormat>('FIVE_A_SIDE');
  const [formationKey, setFormationKey] = useState(getDefaultFormationKey('FIVE_A_SIDE'));
  const [image, setImage] = useState<File>();
  const imagePreview = useMemo(() => (image ? URL.createObjectURL(image) : null), [image]);
  useEffect(
    () => () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    },
    [imagePreview],
  );
  const draft = {
    name,
    shortName: shortName || undefined,
    description: description || undefined,
    locationText: locationText || undefined,
    primaryFormat: format,
    formationKey,
    primaryColor,
    secondaryColor,
  };
  const shortNameValid = !shortName || /^[A-Z0-9]{1,4}$/.test(shortName);
  const identityValid =
    name.trim().length >= 2 && shortNameValid && (!image || image.size <= 5 * 1024 * 1024);
  const submit = () => {
    const parsed = createTeamSchema.safeParse(draft);
    if (!parsed.success) return;
    creation.mutate(
      { input: parsed.data, image },
      { onSuccess: ({ data }) => navigate(`/teams/${data.id}`, { replace: true }) },
    );
  };
  return (
    <section className="mx-auto grid w-full max-w-5xl grid-cols-[minmax(0,1fr)] gap-7">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-brand-700">Create Team</p>
        <h1 className="mt-2 text-3xl font-black text-content-strong">Build your club identity.</h1>
        <p className="mt-2 text-content-muted">
          Team creation is free and will not affect your wallet.
        </p>
      </header>
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
          <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
            <div className="grid gap-4">
              <Input
                label="Team name"
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                required
              />
              <Input
                label="Short name"
                value={shortName}
                maxLength={4}
                pattern="[A-Z0-9]{1,4}"
                onChange={(event) => setShortName(event.target.value.toUpperCase())}
                placeholder="FFC"
                error={shortName && !shortNameValid ? 'Use up to four letters or numbers.' : undefined}
                hint="Unique, uppercase, and no more than four letters or numbers."
              />
              <label className="grid gap-2 text-sm font-semibold text-content">
                Description
                <textarea
                  className="min-h-28 rounded-xl border border-line-strong bg-surface p-3 font-normal text-content-strong"
                  maxLength={1000}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <Input
                label="Location"
                value={locationText}
                maxLength={160}
                onChange={(event) => setLocationText(event.target.value)}
                placeholder="Johannesburg"
              />
              <label className="grid gap-2 text-sm font-semibold text-content">
                Team profile image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => setImage(event.target.files?.[0])}
                  className="rounded-xl border border-line-strong bg-surface p-3 font-normal"
                />
                <span className="font-normal text-content-muted">
                  PNG, JPEG or WEBP, up to 5 MB.
                </span>
              </label>
              <div className="grid grid-cols-2 gap-4">
                <label className="grid gap-2 text-sm font-semibold text-content">
                  Primary color
                  <input
                    aria-label="Primary team color"
                    type="color"
                    value={primaryColor}
                    onChange={(event) => setPrimaryColor(event.target.value)}
                    className="h-12 w-full rounded-xl border border-line-strong bg-surface p-1"
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold text-content">
                  Secondary color
                  <input
                    aria-label="Secondary team color"
                    type="color"
                    value={secondaryColor}
                    onChange={(event) => setSecondaryColor(event.target.value)}
                    className="h-12 w-full rounded-xl border border-line-strong bg-surface p-1"
                  />
                </label>
              </div>
            </div>
            <TeamPreview
              name={name || 'Your Team'}
              shortName={shortName}
              profileImageUrl={imagePreview}
              primaryColor={primaryColor}
              secondaryColor={secondaryColor}
            />
          </div>
        )}
        {step === 1 && (
          <div className="grid gap-7">
            <fieldset>
              <legend className="text-lg font-bold text-content-strong">Primary format</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {MATCH_FORMATS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setFormat(item);
                      setFormationKey(getDefaultFormationKey(item));
                    }}
                    className={`rounded-2xl border p-5 text-left ${format === item ? 'border-brand-500 bg-brand-50 ring-4 ring-brand-100' : 'border-line bg-surface'}`}
                  >
                    <span className="text-2xl font-black text-content-strong">
                      {MATCH_FORMAT_CONFIG[item].shortLabel}
                    </span>
                    <span className="mt-1 block text-sm text-content-muted">
                      {MATCH_FORMAT_CONFIG[item].label}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-lg font-bold text-content-strong">Starting formation</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {FORMATION_PRESETS[format].map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => setFormationKey(preset.key)}
                    className={`rounded-2xl border p-4 text-left font-bold ${formationKey === preset.key ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-content-strong'}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        )}
        {step === 2 && (
          <div className="grid gap-6 md:grid-cols-[auto_1fr]">
            <TeamAvatar
              team={{ name: name || 'Your Team', shortName, profileImageUrl: imagePreview }}
              size="lg"
            />
            <div>
              <h2 className="text-3xl font-black text-content-strong">{name}</h2>
              <p className="mt-2 text-content-muted">{description || 'No description provided.'}</p>
              <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                <Review label="Short name" value={shortName || 'Not set'} />
                <Review label="Location" value={locationText || 'Not set'} />
                <Review label="Format" value={MATCH_FORMAT_CONFIG[format].label} />
                <Review
                  label="Formation"
                  value={
                    FORMATION_PRESETS[format].find(({ key }) => key === formationKey)?.label ??
                    formationKey
                  }
                />
              </dl>
            </div>
          </div>
        )}
        <FormError
          message={
            creation.error?.message ??
            (!identityValid && step === 0
              ? 'Enter a Team name and choose an image no larger than 5 MB.'
              : undefined)
          }
        />
        <div className="mt-7 flex justify-between border-t border-line pt-5">
          {step > 0 ? (
            <Button variant="secondary" onClick={() => setStep((value) => value - 1)}>
              Previous
            </Button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <Button
              disabled={step === 0 && !identityValid}
              onClick={() => setStep((value) => value + 1)}
            >
              Continue
            </Button>
          ) : (
            <Button loading={creation.isPending} onClick={submit}>
              Create Team
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function TeamPreview(props: {
  name: string;
  shortName: string;
  profileImageUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}) {
  return (
    <aside className="h-fit overflow-hidden rounded-3xl border border-line bg-surface shadow-soft">
      <div
        className="h-24"
        style={{
          background: `linear-gradient(135deg, ${props.primaryColor}, ${props.secondaryColor})`,
        }}
      />
      <div className="-mt-9 p-5">
        <TeamAvatar team={props} size="lg" />
        <h2 className="mt-4 text-xl font-black text-content-strong">{props.name}</h2>
        <p className="text-sm text-content-muted">Live Team preview</p>
      </div>
    </aside>
  );
}
function Review({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase text-content-muted">{label}</dt>
      <dd className="mt-1 font-semibold text-content-strong">{value}</dd>
    </div>
  );
}
