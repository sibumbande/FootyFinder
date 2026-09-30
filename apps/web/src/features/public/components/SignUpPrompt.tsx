import { Link, useLocation } from 'react-router-dom';

const here = (location: { pathname: string; search: string; hash: string }) => encodeURIComponent(`${location.pathname}${location.search}${location.hash}`);

/**
 * Gate 9 / TKT-910: every action that needs a profile shows this to guests. Signing up (then
 * verifying and finishing the profile) returns them to the same page.
 */
export function SignUpPrompt({ action = 'play', compact = false }: { action?: string; compact?: boolean }) {
  const location = useLocation();
  if (compact)
    return (
      <Link className="inline-flex min-h-8 items-center rounded-md border-2 border-brand-900 bg-brand-600 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.06em] text-content-inverse" to={`/register?returnTo=${here(location)}`}>
        Sign up to {action}
      </Link>
    );
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-4" data-testid="sign-up-prompt">
      <p className="flex-1 text-sm font-semibold text-brand-700">Sign up to {action}. It's free, and you'll come straight back here.</p>
      <Link className="button" to={`/register?returnTo=${here(location)}`}>Sign up to play</Link>
      <Link className="button-secondary" to={`/login?returnTo=${here(location)}`}>Log in</Link>
    </div>
  );
}
