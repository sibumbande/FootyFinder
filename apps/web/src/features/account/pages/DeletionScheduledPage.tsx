import { Link, useSearchParams } from 'react-router-dom';
import { formatWhen } from '../format.js';

/** CEO batch 5, item 2: shown after confirming; the player is already signed out everywhere. */
export function DeletionScheduledPage() {
  const [params] = useSearchParams();
  const until = params.get('until');
  return (
    <section className="mx-auto grid max-w-xl gap-4 rounded-3xl border border-line bg-surface p-8 text-center shadow-soft">
      <h1 className="text-2xl font-bold text-content-strong">Your account is being deleted</h1>
      <p className="text-content">
        Your account is deactivated and you have been signed out everywhere. We've emailed you a confirmation.
      </p>
      {until && (
        <p className="text-content">
          It will be deleted on <strong>{formatWhen(until)}</strong>. Changed your mind? Sign in before then and the
          deletion is cancelled.
        </p>
      )}
      <Link className="font-bold text-brand-700 hover:underline" to="/">
        Back to FootyFinder
      </Link>
    </section>
  );
}
