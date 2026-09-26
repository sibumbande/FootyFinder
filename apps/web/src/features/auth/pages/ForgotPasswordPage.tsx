import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout.js';
import { Input } from '@/components/ui/Input.js';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useRequestPasswordReset } from '../hooks/useAuth.js';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const request = useRequestPasswordReset();
  return (
    <AuthLayout eyebrow="Account recovery" title="Reset your password" description="We will send a single-use 30-minute link if the account is eligible.">
      <form className="grid gap-5 rounded-2xl border border-line bg-surface p-6 shadow-soft" onSubmit={(event) => { event.preventDefault(); request.mutate({ email }); }}>
        <Input label="Email address" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <Button type="submit" loading={request.isPending}>Send reset link</Button>
        {request.isSuccess && <p className="text-sm text-content-muted">If an eligible account exists, password-reset instructions have been sent.</p>}
        <FormError message={request.error?.message} />
        <Link className="text-center text-sm font-bold text-brand-700 hover:underline" to="/login">Return to sign in</Link>
      </form>
    </AuthLayout>
  );
}
