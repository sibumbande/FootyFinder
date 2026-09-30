import { FOOTBALL_POSITIONS, type FootballPosition } from '@footy-finder/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { useResendVerification } from '@/features/auth/hooks/useAuth.js';
import { safeReturnTo } from '@/features/auth/utils/return-to.js';
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
  const [yearsExperience, setYearsExperience] = useState('');
  const [cityId, setCityId] = useState('');
  const [positions, setPositions] = useState<FootballPosition[]>([]);
  const [photo, setPhoto] = useState<File>();
  const [acceptedIds, setAcceptedIds] = useState<string[]>([]);
  const [waitlistConsent, setWaitlistConsent] = useState(false);
  useEffect(() => {
    if (!user) return;
    setDateOfBirth(user.dateOfBirth ?? '');
    setYearsExperience(user.yearsExperience === null || user.yearsExperience === undefined ? '' : String(user.yearsExperience));
    setCityId(user.city?.id ?? '');
    setPositions(user.preferredPositions);
  }, [user]);
  if (status.isPending) return <div className="mx-auto h-96 max-w-4xl animate-pulse rounded-3xl bg-surface" />;
  if (!status.data || !user) return <FormError message={status.error?.message ?? 'Onboarding status is unavailable.'} />;
  const selectedCity = cities.data?.find(({ id }) => id === cityId);
  const togglePosition = (position: FootballPosition) => setPositions((current) => current.includes(position) ? current.filter((item) => item !== position) : current.length < 4 ? [...current, position] : current);
  return (
    <section className="mx-auto grid max-w-4xl gap-6">
      <div><p className="anime-kicker">Player activation</p><h1 className="mt-2 text-4xl font-black uppercase text-content-strong">Complete your profile</h1><p className="mt-3 text-content-muted">Your progress is saved step by step. Existing matches, teams, wallet and read access remain intact.</p></div>
      {!user.emailVerified && <Card title="1. Verify your email"><p className="text-sm text-content-muted">Verify {user.email} before activation.</p><div className="flex flex-wrap gap-3"><Button loading={resend.isPending} onClick={() => resend.mutate()}>Resend email</Button><Link className="button" to={`/verify-email?returnTo=${encodeURIComponent(returnTo)}`}>I have a verification link</Link></div><FormError message={resend.error?.message} /></Card>}
      <Card title="2. Player details">
        <div className="grid gap-4 sm:grid-cols-2"><Input label="Date of birth" type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} hint="Stored privately for 18+ enforcement." /><Input label="Whole years of experience" type="number" min="0" max="60" value={yearsExperience} onChange={(event) => setYearsExperience(event.target.value)} /></div>
        <label className="grid gap-2 text-xs font-black uppercase tracking-wide text-content">City<select className="min-h-12 rounded-md border-2 border-line-strong bg-surface px-3" value={cityId} onChange={(event) => setCityId(event.target.value)}><option value="">Choose a city</option>{cities.data?.map((city) => <option key={city.id} value={city.id}>{city.name}{city.supportStatus === 'WAITLIST' ? ' — coming soon' : ''}</option>)}</select></label>
        {selectedCity?.supportStatus === 'WAITLIST' ? <div className="grid gap-3 rounded-xl border border-warning-300 bg-warning-50 p-4"><p className="font-bold text-content-strong">Footy Finder is not active in {selectedCity.name} yet.</p><label className="flex gap-2 text-sm"><input type="checkbox" checked={waitlistConsent} onChange={(event) => setWaitlistConsent(event.target.checked)} />Send only launch and availability updates for this city.</label><Button disabled={!waitlistConsent} loading={waitlist.isPending} onClick={() => waitlist.mutate({ cityId, email: user.email, consent: true, source: 'ONBOARDING' })}>Join city waiting list</Button>{waitlist.isSuccess && <p className="text-sm font-bold text-success-700">Waiting-list interest saved. No active Cape Town profile was created.</p>}</div> : null}
        <fieldset><legend className="text-xs font-black uppercase tracking-wide text-content">Preferred positions — select in preference order</legend><div className="mt-2 flex flex-wrap gap-2">{FOOTBALL_POSITIONS.map((position) => <button type="button" key={position} onClick={() => togglePosition(position)} className={`rounded-full border px-3 py-2 text-sm font-bold ${positions.includes(position) ? 'border-brand-700 bg-brand-100 text-brand-700' : 'border-line bg-surface'}`}>{positions.indexOf(position) >= 0 ? `${positions.indexOf(position) + 1}. ` : ''}{position.toLowerCase()}</button>)}</div></fieldset>
        <Button disabled={selectedCity?.supportStatus !== 'ACTIVE' || !dateOfBirth || yearsExperience === '' || positions.length === 0} loading={saveProfile.isPending} onClick={() => saveProfile.mutate({ dateOfBirth, yearsExperience: Number(yearsExperience), cityId, preferredPositions: positions })}>Save player details</Button><FormError message={(saveProfile.error ?? waitlist.error)?.message} />
      </Card>
      <Card title="3. Profile photo"><p className="text-sm text-content-muted">JPEG, PNG or WEBP; up to 5 MB and at least 256×256. The server corrects orientation, creates a square normalized display image, and does not retain the original.</p><input aria-label="Player photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0])} /><Button disabled={!photo} loading={upload.isPending} onClick={() => photo && upload.mutate(photo)}>Upload and normalize photo</Button><FormError message={upload.error?.message} /></Card>
      <Card title="4. Legal acceptance">{legal.data?.length ? <><div className="grid gap-3">{legal.data.map((document) => <label key={document.id} className="flex gap-3 rounded-xl border border-line p-3 text-sm"><input type="checkbox" checked={acceptedIds.includes(document.id)} onChange={(event) => setAcceptedIds((ids) => event.target.checked ? [...new Set([...ids, document.id])] : ids.filter((id) => id !== document.id))} /><span><span className="font-bold">{document.title}</span> — version {document.version}, effective {new Date(document.effectiveAt).toLocaleDateString()}</span></label>)}</div><Button disabled={acceptedIds.length !== legal.data.length} loading={accept.isPending} onClick={() => accept.mutate({ documentIds: acceptedIds, source: user.onboardingComplete ? 'REACCEPTANCE' : 'PROFILE_COMPLETION' })}>Record acceptance</Button></> : <div className="rounded-xl border border-warning-300 bg-warning-50 p-4"><p className="font-bold text-content-strong">Activation is waiting for the Terms of Service to be published.</p><p className="mt-2 text-sm text-content-muted">No acceptance will be fabricated. You can finish the other steps in the meantime.</p><Link className="mt-3 inline-block font-bold text-brand-700 underline" to="/legal/about">View legal publication status</Link></div>}<FormError message={accept.error?.message} /></Card>
      <Card title="5. Activate"><p className="text-sm text-content-muted">Outstanding: {status.data.missing.length ? status.data.missing.join(', ') : 'none'}</p><Button disabled={!status.data.canComplete} loading={complete.isPending} onClick={() => complete.mutate(undefined, { onSuccess: () => navigate(returnTo, { replace: true }) })}>Activate player profile</Button><FormError message={complete.error?.message} /></Card>
    </section>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="grid gap-4 rounded-3xl border border-line bg-surface p-6 shadow-soft"><h2 className="text-xl font-black text-content-strong">{title}</h2>{children}</section>;
}
