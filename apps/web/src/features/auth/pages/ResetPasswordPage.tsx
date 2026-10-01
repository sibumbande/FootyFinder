import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout.js';
import { Input } from '@/components/ui/Input.js';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useResetPassword } from '../hooks/useAuth.js';

export function ResetPasswordPage() {
  const [search] = useSearchParams();
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const reset = useResetPassword();
  const token = search.get('token') ?? '';
  return (
    <AuthLayout eyebrow="Account recovery" title="Choose a new password" description="A successful reset ends every active session.">
      <form className="grid gap-5 rounded-2xl border border-line bg-surface p-6 shadow-soft" onSubmit={(event) => { event.preventDefault(); reset.mutate({ token, password }, { onSuccess: () => navigate('/login', { replace: true }) }); }}>
        <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} hint="At least eight characters, including a letter and a number." required />
        <Button type="submit" loading={reset.isPending} disabled={!token}>Reset password</Button>
        {!token && <FormError message="This reset link is missing its token." />}
        <FormError message={reset.error?.message} />
        <Link className="inline-flex min-h-11 items-center justify-center text-sm font-bold text-brand-700 hover:underline" to="/forgot-password">Request another link</Link>
      </form>
    </AuthLayout>
  );
}
