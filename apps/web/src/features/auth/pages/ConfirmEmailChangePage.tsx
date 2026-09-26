import { Link, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout.js';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useConfirmEmailChange } from '../hooks/useAuth.js';

export function ConfirmEmailChangePage() {
  const [search] = useSearchParams();
  const token = search.get('token') ?? '';
  const confirm = useConfirmEmailChange();
  return (
    <AuthLayout eyebrow="Account security" title="Confirm email change" description="Your old address remains active until this confirmation succeeds.">
      <div className="grid gap-4 rounded-2xl border border-line bg-surface p-6 shadow-soft">
        <Button disabled={!token} loading={confirm.isPending} onClick={() => confirm.mutate({ token })}>Confirm new email</Button>
        {confirm.isSuccess && <p className="text-sm font-semibold text-success-700">Your sign-in email has been updated.</p>}
        <FormError message={confirm.error?.message} />
        <Link className="text-center text-sm font-bold text-brand-700 hover:underline" to="/">Continue</Link>
      </div>
    </AuthLayout>
  );
}
