import { Link } from 'react-router-dom';

/** CEO batch 5, item 2 (D6): shown once after a sign-in that cancelled the account deletion. */
export function WelcomeBackPage() {
  return (
    <section className="mx-auto grid max-w-xl gap-4 rounded-3xl border border-line bg-surface p-8 text-center shadow-soft">
      <h1 className="text-2xl font-bold text-content-strong">Welcome back</h1>
      <p className="text-content">
        Your account deletion was cancelled and your account is active again. We've emailed you to confirm.
      </p>
      <p className="text-content-muted">
        Your friends, teams and messages are back. Matches you left when you asked for deletion stay left, and your
        "Looking for a team" card stays off until you switch it on again.
      </p>
      <Link className="font-bold text-brand-700 hover:underline" to="/">
        Go to FootyFinder
      </Link>
    </section>
  );
}
