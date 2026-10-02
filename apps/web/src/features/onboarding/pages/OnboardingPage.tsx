import { FOOTBALL_POSITIONS, TERMS_ACCEPTANCE_STATEMENT, TERMS_ANCHORS, type FootballPosition, type Gender } from '@footy-finder/shared';
import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { useResendVerification } from '@/features/auth/hooks/useAuth.js';
import { safeReturnTo } from '@/features/auth/utils/return-to.js';
import { GenderChoice } from '../components/GenderChoice.js';
import {
  useAcceptLegal,
  useCities,
  useCompleteOnboarding,
  useJoinCityInterest,
  useLegalDocuments,
  useOnboardingStatus,
  useSaveOnboardingProfile,
  useUploadPlayerPhoto,
} from '../hooks/useOnboarding.js';

export function OnboardingPage() {
  const status = useOnboardingStatus();
  const cities = useCities();
  const legal = useLegalDocuments();
  const saveProfile = useSaveOnboardingProfile();
  const upload = useUploadPlayerPhoto();
  const accept = useAcceptLegal();
  const complete = useCompleteOnboarding();
  const resend = useResendVerification();
  const waitlist = useJoinCityInterest();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = safeReturnTo(search.get('returnTo'));
  const user = status.data?.user;
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [cityId, setCityId] = useState('');
  const [positions, setPositions] = useState<FootballPosition[]>([]);
  const [photo, setPhoto] = useState<File>();
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [waitlistConsent, setWaitlistConsent] = useState(false);
  useEffect(() => {
    if (!user) return;
    setDateOfBirth(user.dateOfBirth ?? '');
    setGender(user.gender ?? '');
    setYearsExperience(user.yearsExperience === null || user.yearsExperience === undefined ? '' : String(user.yearsExperience));
    setCityId(user.city?.id ?? '');
    setPositions(user.preferredPositions);
  }, [user]);
  if (status.isPending) return <div className="mx-auto h-96 max-w-4xl animate-pulse rounded-3xl bg-surface" />;
  if (!status.data || !user) return <FormError message={status.error?.message ?? 'Onboarding status is unavailable.'} />;
  const selectedCity = cities.data?.find(({ id }) => id === cityId);
  const terms = legal.data?.find(({ type }) => type === 'TERMS');
  const togglePosition = (position: FootballPosition) => setPositions((current) => current.includes(position) ? current.filter((item) => item !== position) : current.length < 4 ? [...current, position] : current);
  return (
    <section className="mx-auto grid w-full max-w-4xl grid-cols-[minmax(0,1fr)] gap-6">
      <div><p className="anime-kicker">Player activation</p><h1 className="mt-2 text-4xl font-black uppercase text-content-strong">Complete your profile</h1><p className="mt-3 text-content-muted">Your progress is saved step by step. Existing matches, teams, wallet and read access remain intact.</p></div>
      {!user.emailVerified && <Card title="1. Verify your email"><p className="text-sm text-content-muted">Verify {user.email} before activation.</p><div className="flex flex-wrap gap-3"><Button loading={resend.isPending} onClick={() => resend.mutate()}>Resend email</Button><Link className="button" to={`/verify-email?returnTo=${encodeURIComponent(returnTo)}`}>I have a verification link</Link></div><FormError message={resend.error?.message} /></Card>}
      <Card title="2. Player details">
        {/* CEO touch-up batch 2, item 3: the two fields line up: same height, width, style and a hint each. */}
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 sm:grid-cols-2"><Input label="Date of birth" type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} hint="Stored privately for 18+ enforcement." /><Input label="Whole years of experience" type="number" inputMode="numeric" min="0" max="60" value={yearsExperience} onChange={(event) => setYearsExperience(event.target.value)} hint="Whole years you've played football." /></div>
        {/* CEO touch-up batch 4, item 1: required, private, saved once. */}
        <GenderChoice value={gender} onChange={setGender} locked={Boolean(user.gender)} />
        <label className="grid gap-2 text-xs font-black uppercase tracking-[0.08em] text-content">City<select className="h-12 w-full rounded-md border-2 border-line-strong bg-surface px-3.5 text-sm font-semibold normal-case tracking-normal text-content-strong outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100" value={cityId} onChange={(event) => setCityId(event.target.value)}><option value="">Choose a city</option>{cities.data?.map((city) => <option key={city.id} value={city.id}>{city.name}{city.supportStatus === 'WAITLIST' ? ' — coming soon' : ''}</option>)}</select></label>
        {selectedCity?.supportStatus === 'WAITLIST' ? <div className="grid gap-3 rounded-xl border border-warning-300 bg-warning-50 p-4"><p className="font-bold text-content-strong">Footy Finder is not active in {selectedCity.name} yet.</p><label className="flex gap-2 text-sm"><input type="checkbox" checked={waitlistConsent} onChange={(event) => setWaitlistConsent(event.target.checked)} />Send only launch and availability updates for this city.</label><Button disabled={!waitlistConsent} loading={waitlist.isPending} onClick={() => waitlist.mutate({ cityId, email: user.email, consent: true, source: 'ONBOARDING' })}>Join city waiting list</Button>{waitlist.isSuccess && <p className="text-sm font-bold text-success-700">Waiting-list interest saved. No active Cape Town profile was created.</p>}</div> : null}
        <fieldset><legend className="text-xs font-black uppercase tracking-[0.08em] text-content">Preferred positions — select in preference order</legend><div className="mt-2 flex flex-wrap gap-2">{FOOTBALL_POSITIONS.map((position) => <button type="button" key={position} onClick={() => togglePosition(position)} className={`rounded-full border px-3 py-2 text-sm font-bold ${positions.includes(position) ? 'border-brand-700 bg-brand-100 text-brand-700' : 'border-line bg-surface'}`}>{positions.indexOf(position) >= 0 ? `${positions.indexOf(position) + 1}. ` : ''}{position.toLowerCase()}</button>)}</div></fieldset>
        <Button disabled={selectedCity?.supportStatus !== 'ACTIVE' || !dateOfBirth || !gender || yearsExperience === '' || positions.length === 0} loading={saveProfile.isPending} onClick={() => gender && saveProfile.mutate({ dateOfBirth, gender, yearsExperience: Number(yearsExperience), cityId, preferredPositions: positions })}>Save player details</Button><FormError message={(saveProfile.error ?? waitlist.error)?.message} />
      </Card>
      {/* CEO touch-up batch 2, item 4: plain wording, front camera on phones (ToS 5.3: a selfie showing your full face). */}
      <Card title="3. Upload a selfie"><p className="text-sm text-content-muted">Take or upload a clear selfie showing your full face. Teammates and referees use it to recognise you.</p><SelfiePicker photo={photo} onPick={setPhoto} /><Button disabled={!photo} loading={upload.isPending} onClick={() => photo && upload.mutate(photo)}>Upload selfie</Button><FormError message={upload.error?.message} /></Card>
      <Card title="4. Terms of Service">{terms ? <>
        {/* CEO Q1: one document, one checkbox. */}
        <label className="flex gap-3 rounded-xl border border-line p-3 text-sm">
          <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />
          <span>{TERMS_ACCEPTANCE_STATEMENT}</span>
        </label>
        <p className="text-sm text-content-muted">
          Read the <Link className="font-bold text-brand-700 underline" to="/legal/terms" target="_blank">Terms of Service</Link> (version {terms.version}), the{' '}
          <Link className="font-bold text-brand-700 underline" to={`/legal/terms#${TERMS_ANCHORS.privacy}`} target="_blank">Privacy Notice (clause 8)</Link> and the{' '}
          <Link className="font-bold text-brand-700 underline" to={`/legal/terms#${TERMS_ANCHORS.riskWaiver}`} target="_blank">injury risk waiver (clause 9)</Link>.
        </p>
        <Button disabled={!termsAccepted} loading={accept.isPending} onClick={() => accept.mutate({ documentIds: [terms.id], source: user.onboardingComplete ? 'REACCEPTANCE' : 'PROFILE_COMPLETION' })}>Accept the Terms</Button>
      </> :<div className="rounded-xl border border-warning-300 bg-warning-50 p-4"><p className="font-bold text-content-strong">Activation is waiting for the Terms of Service to be published.</p><p className="mt-2 text-sm text-content-muted">No acceptance will be fabricated. You can finish the other steps in the meantime.</p><Link className="mt-3 inline-block font-bold text-brand-700 underline" to="/legal/terms">View the Terms page</Link></div>}<FormError message={accept.error?.message} /></Card>
      <Card title="5. Activate"><p className="text-sm text-content-muted">Outstanding: {status.data.missing.length ? status.data.missing.join(', ') : 'none'}</p><Button disabled={!status.data.canComplete} loading={complete.isPending} onClick={() => complete.mutate(undefined, { onSuccess: () => navigate(returnTo, { replace: true }) })}>Activate player profile</Button><FormError message={complete.error?.message} /></Card>
    </section>
  );
}

const isTouchDevice = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
const pickerClass = 'relative inline-flex min-h-12 cursor-pointer items-center justify-center rounded-md border-2 border-line-strong bg-surface px-4 text-sm font-black uppercase tracking-wide text-content-strong shadow-[2px_3px_0_rgb(var(--theme-ink)/0.16)] transition hover:bg-surface-hover focus-within:ring-4 focus-within:ring-brand-100';

/** Two ways in: the front camera (phones and tablets only; desktops ignore `capture`) or the gallery / files. */
function SelfiePicker({ photo, onPick }: { photo?: File; onPick: (file?: File) => void }) {
  const [touch] = useState(isTouchDevice);
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (!photo || typeof URL.createObjectURL !== 'function') return setPreview(undefined);
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  const pick = (event: ChangeEvent<HTMLInputElement>) => onPick(event.target.files?.[0]);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {preview && <img src={preview} alt="Your selfie" className="size-20 rounded-full border-2 border-line-strong object-cover" />}
      {touch && <label className={pickerClass}>Take a selfie<input className="sr-only" type="file" accept="image/*" capture="user" aria-label="Take a selfie with your camera" onChange={pick} /></label>}
      <label className={pickerClass}>{touch ? 'Choose from gallery' : 'Choose a photo'}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose a selfie from your photos" onChange={pick} /></label>
      {photo && <span className="min-w-0 truncate text-sm text-content-muted">{photo.name}</span>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 rounded-3xl border border-line bg-surface p-5 shadow-soft sm:p-6"><h2 className="text-xl font-black text-content-strong">{title}</h2>{children}</section>;
}
