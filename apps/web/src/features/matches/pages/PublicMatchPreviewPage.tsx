import { MATCH_FORMAT_CONFIG } from '@footy-finder/shared';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Logo } from '@/components/Logo.js';
import { ThemeToggle } from '@/components/ThemeToggle.js';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { PublicResult } from '@/features/public/components/PublicResult.js';
import { formatCurrency } from '@/utils/format-currency.js';
import { formatDate } from '@/utils/format-date.js';
import { JoinTeamDialog } from '../components/JoinTeamDialog.js';
import { GoNoGoBanner } from '../components/GoNoGoBanner.js';
import { ShareMatchActions } from '../components/ShareMatchActions.js';
import { useMatchByPublicSlug, usePublicMatchPreview } from '../hooks/useMatches.js';

export function PublicMatchPreviewPage() {
  const { slug = '' } = useParams();
  const { user, isPending: authPending } = useAuth();
  const previewQuery = usePublicMatchPreview(slug);
  const needsVerification = Boolean(user?.emailVerificationRequired && !user.emailVerified);
  const isActive = Boolean(user && !needsVerification && user.onboardingComplete);
  const matchQuery = useMatchByPublicSlug(slug, isActive);
  const [joinOpen, setJoinOpen] = useState(false);
  const preview = previewQuery.data;
  const returnTo = `/m/${slug}`;

  if (previewQuery.isPending)
    return <div className="mx-auto mt-12 h-[36rem] max-w-4xl animate-pulse rounded-3xl bg-surface" />;
  if (!preview || previewQuery.error)
    return (
      <PublicShell>
        <section className="mx-auto max-w-xl rounded-3xl border border-line bg-surface p-8 text-center shadow-soft">
          <h1 className="text-2xl font-black text-content-strong">Match unavailable</h1>
          <FormError message="This public match link is invalid or unavailable." />
          <Link className="button mt-5 inline-flex" to="/login">
            Sign in
          </Link>
        </section>
      </PublicShell>
    );

  const match = matchQuery.data;
  const alreadyJoined = match?.participants?.some((participant) => participant.userId === user?.id);
  const shareFacts = {
    canonicalUrl: preview.canonicalUrl,
    name: preview.name,
    venueName: preview.venue.name,
    startsAt: preview.startsAt,
    filled: preview.capacity.filled,
    total: preview.capacity.total,
    feeCents: preview.feeCents,
  };

  return (
    <PublicShell>
      <main className="mx-auto grid max-w-4xl gap-6">
        <section className="rounded-3xl bg-brand-900 p-6 text-content-inverse shadow-soft sm:p-9">
          <div className="flex flex-wrap gap-2 text-xs font-black uppercase tracking-wider">
            <span className="rounded-full bg-brand-100 px-3 py-1 text-brand-700">
              {MATCH_FORMAT_CONFIG[preview.format].shortLabel}
            </span>
            <span className="rounded-full bg-content-inverse/10 px-3 py-1">
              {preview.status.replace('_', ' ')}
            </span>
          </div>
          <h1 className="mt-5 text-3xl font-black sm:text-5xl">{preview.name}</h1>
          {preview.description && <p className="mt-3 max-w-2xl text-hero-muted">{preview.description}</p>}
          <dl className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Venue" value={`${preview.venue.name}, ${preview.venue.city}`} />
            <Fact label="Kickoff" value={formatDate(preview.startsAt)} />
            <Fact label="Players" value={`${preview.capacity.filled}/${preview.capacity.total}`} />
            <Fact label="Fee" value={preview.feeCents ? formatCurrency(preview.feeCents) : 'Free'} />
          </dl>
          <div className="mt-7">
            <ShareMatchActions facts={shareFacts} />
          </div>
        </section>

        <GoNoGoBanner
          facts={preview}
          status={preview.status}
          feeCents={preview.feeCents}
          filled={preview.positions?.filled ?? 0}
          total={preview.positions?.total ?? 0}
          venueName={preview.venue.name}
          startsAt={preview.startsAt}
        />

        {preview.result && <PublicResult result={preview.result} />}

        <section className="rounded-3xl border border-line bg-surface p-6 shadow-sm sm:p-8">
          <h2 className="text-2xl font-black text-content-strong">Join this match</h2>
          <p className="mt-2 text-content-muted">{joinMessage(preview.joinability.reason)}</p>
          {preview.rules.length > 0 && (
            <p className="mt-3 text-sm text-content-muted">
              Rules: {preview.rules.map(({ label }) => label).join(', ')}
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            {!authPending && !user && (
              <>
                <Link className="button inline-flex" to={`/register?returnTo=${encodeURIComponent(returnTo)}`}>
                  Sign up to play
                </Link>
                <Link className="button-secondary inline-flex" to={`/login?returnTo=${encodeURIComponent(returnTo)}`}>
                  Log in
                </Link>
              </>
            )}
            {user && needsVerification && (
              <Link className="button inline-flex" to={`/verify-email?returnTo=${encodeURIComponent(returnTo)}`}>
                Verify email to continue
              </Link>
            )}
            {user && !needsVerification && !user.onboardingComplete && (
              <Link className="button inline-flex" to={`/onboarding?returnTo=${encodeURIComponent(returnTo)}`}>
                Complete profile to continue
              </Link>
            )}
            {isActive && alreadyJoined && match && (
              <Link className="button inline-flex" to={`/matches/${match.id}`}>
                Open match lobby
              </Link>
            )}
            {isActive && !alreadyJoined && preview.joinability.canJoin && match && (
              <Button onClick={() => setJoinOpen(true)}>Join this match</Button>
            )}
          </div>
          {isActive && matchQuery.error && (
            <FormError message="Your account cannot open this match right now." />
          )}
        </section>
      </main>
      {match && (
        <JoinTeamDialog match={match} open={joinOpen} onClose={() => setJoinOpen(false)} />
      )}
    </PublicShell>
  );
}

function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas px-4 pb-12">
      <header className="mx-auto flex max-w-6xl items-center justify-between py-5">
        <Logo />
        <ThemeToggle />
      </header>
      {children}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-content-inverse/10 p-4">
      <dt className="text-xs font-bold uppercase text-hero-muted">{label}</dt>
      <dd className="mt-1 font-black">{value}</dd>
    </div>
  );
}

function joinMessage(reason: string) {
  switch (reason) {
    case 'AVAILABLE':
      return 'Places are available. Sign in or create an account to choose a team.';
    case 'FULL':
      return 'This match is full. The page remains available for match details.';
    case 'CANCELLED':
      return 'This match has been cancelled and cannot be joined.';
    case 'STARTED':
      return 'This match has already started and cannot be joined.';
    case 'COMPLETED':
      return 'This match has finished and cannot be joined.';
    case 'LINEUP_LOCKED':
      return 'The lineup locked 30 minutes before kickoff, so this match can no longer be joined.';
    default:
      return 'This match is not accepting players.';
  }
}
