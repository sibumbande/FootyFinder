import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout.js';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useResendVerification, useVerifyEmail } from '../hooks/useAuth.js';
import { safeReturnTo } from '../utils/return-to.js';

export function VerifyEmailPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const token = search.get('token');
  const returnTo = safeReturnTo(search.get('returnTo'), '/');
  return (
    <AuthLayout eyebrow="Account security" title="Verify your email" description="Verification links expire after 24 hours and can be used once.">
      <div className="grid gap-4 rounded-2xl border border-line bg-surface p-6 shadow-soft">
        {token ? (
          <Button loading={verify.isPending} onClick={() => verify.mutate({ token }, { onSuccess: () => navigate(`/onboarding?returnTo=${encodeURIComponent(returnTo)}`, { replace: true }) })}>
            Verify email
          </Button>
        ) : (
          <>
            <p className="text-sm text-content-muted">Open the link sent to your email, or request another message while signed in.</p>
            <Button loading={resend.isPending} onClick={() => resend.mutate()}>Resend verification email</Button>
          </>
        )}
        {(verify.isSuccess || resend.isSuccess) && <p className="text-sm font-semibold text-success-700">{verify.isSuccess ? 'Email verified. Continuing to profile setup…' : 'If delivery is available, a new email has been sent.'}</p>}
        <FormError message={(verify.error ?? resend.error)?.message} />
        <Link className="inline-flex min-h-11 items-center justify-center text-sm font-bold text-brand-700 hover:underline" to="/login">Return to sign in</Link>
      </div>
    </AuthLayout>
  );
}
