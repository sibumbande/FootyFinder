import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from '@/features/auth/components/AuthLayout.js';
import { Input } from '@/components/ui/Input.js';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useCities, useJoinCityInterest } from '../hooks/useOnboarding.js';

export function WaitingListPage() {
  const cities = useCities();
  const join = useJoinCityInterest();
  const [cityId, setCityId] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const waitingCities = cities.data?.filter(({ supportStatus }) => supportStatus === 'WAITLIST') ?? [];
  return (
    <AuthLayout eyebrow="Coming soon" title="Join your city list" description="Consent applies only to launch and availability updates for your selected city.">
      <form className="grid gap-5 rounded-2xl border border-line bg-surface p-6 shadow-soft" onSubmit={(event) => { event.preventDefault(); join.mutate({ cityId, email, consent: true, source: 'WAITING_LIST_PAGE' }); }}>
        <label className="grid gap-2 text-xs font-black uppercase tracking-wide text-content">City<select className="min-h-12 rounded-md border-2 border-line-strong bg-surface px-3" value={cityId} onChange={(event) => setCityId(event.target.value)} required><option value="">Choose a city</option>{waitingCities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</select></label>
        <Input label="Email address" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <label className="flex gap-3 text-sm text-content"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I consent to launch and availability updates for this city. This is not general marketing consent.</span></label>
        <Button type="submit" loading={join.isPending} disabled={!cityId || !email || !consent}>Join waiting list</Button>
        {join.data && <div className="rounded-xl bg-success-50 p-4 text-sm text-success-700"><p className="font-bold">You are on the {join.data.data.city.name} list.</p><p className="mt-1">Keep this management code to check, unsubscribe, or delete the entry:</p><code className="mt-2 block break-all">{join.data.data.managementToken}</code></div>}
        <FormError message={join.error?.message} />
        <Link className="text-center text-sm font-bold text-brand-700 hover:underline" to="/register">Cape Town is active — create an account</Link>
      </form>
    </AuthLayout>
  );
}
