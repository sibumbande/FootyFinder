import { ApiError } from '@footy-finder/api-client';
import { useMutation } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { adminClient } from './api.js';

export const needsFreshMfa = (error: unknown) =>
  error instanceof ApiError && error.code === 'ADMIN_MFA_REVERIFY_REQUIRED';

/**
 * Gate 8 / D25: shows an action's error. When the action needs a fresh authenticator check, it
 * offers the code form inline; after verifying, the admin simply presses the action again.
 */
export function AdminActionError({ error, onVerified }: { error: unknown; onVerified?: () => void }) {
  const [code, setCode] = useState('');
  const verify = useMutation({
    mutationFn: () => adminClient.verifyMfa({ code }),
    onSuccess: () => {
      setCode('');
      onVerified?.();
    },
  });
  if (!error) return verify.isSuccess ? <p className="muted">Verified. Press the button again to finish.</p> : null;
  if (!needsFreshMfa(error))
    return <p className="error">{error instanceof Error ? error.message : 'Something went wrong.'}</p>;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    verify.mutate();
  };
  return (
    <form className="row" onSubmit={submit}>
      <span className="error">This action needs a fresh authenticator check.</span>
      <label>
        Authenticator code
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          inputMode="numeric"
          minLength={6}
          maxLength={6}
          required
        />
      </label>
      <button disabled={verify.isPending}>Verify</button>
      {verify.error && <span className="error">{verify.error.message}</span>}
    </form>
  );
}
