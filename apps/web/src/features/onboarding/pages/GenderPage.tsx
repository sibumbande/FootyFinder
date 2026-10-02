import type { Gender } from '@footy-finder/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { onboardingClient } from '@/api/client.js';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { safeReturnTo } from '@/features/auth/utils/return-to.js';
import { GenderChoice } from '../components/GenderChoice.js';

/**
 * CEO touch-up batch 4, item 1 (D1): players who signed up before gender was asked answer once at their next sign-in,
 * before they can join, pay or change anything.
 */
export function GenderPage() {
  const [gender, setGender] = useState<Gender | ''>('');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const save = useMutation({
    mutationFn: (value: Gender) => onboardingClient.saveGender({ gender: value }),
    onSuccess: async () => {
      await cache.invalidateQueries();
      navigate(safeReturnTo(params.get('returnTo')), { replace: true });
    },
  });
  return (
    <section className="mx-auto grid w-full max-w-xl grid-cols-[minmax(0,1fr)] gap-5 rounded-3xl border border-line bg-surface p-6 shadow-soft sm:p-8">
      <div>
        <p className="anime-kicker">One quick question</p>
        <h1 className="mt-2 text-3xl font-black uppercase text-content-strong">Tell us your gender</h1>
        <p className="mt-2 text-content-muted">FootyFinder now has girls-only matches. We need this once so we know which matches you can join.</p>
      </div>
      <GenderChoice value={gender} onChange={setGender} />
      <Button disabled={!gender || save.isPending} loading={save.isPending} onClick={() => gender && save.mutate(gender)}>Save and continue</Button>
      <FormError message={save.error?.message} />
    </section>
  );
}
