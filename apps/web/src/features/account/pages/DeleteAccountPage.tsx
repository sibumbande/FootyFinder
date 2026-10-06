import type { AccountDeletionMatchPlan, AccountDeletionPreview, AccountDeletionTeamPlan } from '@footy-finder/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { currentUserKey } from '@/features/auth/hooks/useAuth.js';
import { formatWhen } from '../format.js';
import { formatWholeRands } from '@/utils/format-currency.js';
import { useDeletionPreview, useRequestDeletion } from '../hooks/useAccount.js';

const METHOD_NAMES: Record<string, string> = {
  card: 'card',
  apple_pay: 'Apple Pay',
  capitec_pay: 'Capitec Pay',
  eft: 'Instant EFT',
};

function matchLine(plan: AccountDeletionMatchPlan) {
  switch (plan.outcome) {
    case 'REFUNDED':
      return `You leave this match now and your ${formatWholeRands(plan.refundCents)} is refunded to the card or bank you paid with (more than 24 hours before kick-off).`;
    case 'CREDIT_BACK':
      return 'You leave this match now and the match credit you paid with comes back to you (more than 24 hours before kick-off). It is then refunded or lapses with your other credits, below.';
    case 'PAYER_CHOOSES':
      return 'You leave this match now. A teammate paid for your place, so they choose a match credit or a refund (more than 24 hours before kick-off).';
    case 'FORFEITED':
      return 'You leave this match now. It is 24 hours or less before kick-off, so nothing is refunded and your place is released for someone else.';
    case 'NOTHING_PAID':
      return 'You leave this match now. You paid nothing, so nothing is refunded.';
    case 'LEFT_OUT_OF_SQUAD':
      return "You are taken out of your Team's lineup now. The Owner and Captains are told a player left.";
    case 'HOSTED_MATCH_CANCELLED':
      return 'You host this match and nobody has joined it, so it is cancelled now.';
  }
}

function teamLine(plan: AccountDeletionTeamPlan) {
  if (plan.outcome === 'CLOSE') return 'You own this team and are its only member. It is closed when your account is deleted.';
  return 'You stay in the team until your account is deleted, then you are removed.';
}

const credits = (count: number) => `${count} unused match ${count === 1 ? 'credit' : 'credits'}`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-lg font-bold text-content-strong">{title}</h2>
      <div className="mt-3 grid gap-2 text-sm text-content">{children}</div>
    </section>
  );
}

function Summary({ preview }: { preview: AccountDeletionPreview }) {
  const methods = preview.credits.paymentMethods.map((method) => METHOD_NAMES[method] ?? method);
  return (
    <>
      <Section title={`The next ${preview.graceDays} days`}>
        <p>
          When you confirm, your account is <strong>deactivated straight away</strong>: you are signed out on every
          device, and other players can no longer find you in search, Social, friends lists, leaderboards, lineups or
          recruitment. We email you to confirm.
        </p>
        <p>
          <strong>Changed your mind?</strong> Sign in before {formatWhen(preview.scheduledFor)} and the deletion is
          cancelled. Everything comes back as it was.
        </p>
        <p>After that date your account is deleted for good, and we email you once more.</p>
      </Section>

      <Section title="Your matches">
        {preview.matches.length ? (
          preview.matches.map((plan) => (
            <div key={`${plan.matchId}-${plan.outcome}`} className="rounded-xl bg-surface-muted p-3">
              <Link className="font-bold text-brand-700 hover:underline" to={`/matches/${plan.matchId}`}>
                {plan.name}
              </Link>{' '}
              <span className="text-content-muted">· {formatWhen(plan.startsAt)}</span>
              <p className="mt-1">{matchLine(plan)}</p>
            </div>
          ))
        ) : (
          <p>You have no upcoming matches.</p>
        )}
        <p className="text-content-muted">Your past matches and results stay, shown as "Deleted player", so other players' statistics do not change.</p>
      </Section>

      <Section title="Your teams">
        {preview.teams.length ? (
          preview.teams.map((plan) => (
            <div key={plan.teamId} className="rounded-xl bg-surface-muted p-3">
              <Link className="font-bold text-brand-700 hover:underline" to={`/teams/${plan.teamId}`}>
                {plan.name}
              </Link>
              <p className="mt-1">{teamLine(plan)}</p>
            </div>
          ))
        ) : (
          <p>You are not in any teams.</p>
        )}
      </Section>

      <Section title="Your match credits">
        {preview.credits.refunded > 0 && (
          <p data-testid="credits-refunded">
            <strong>Your {credits(preview.credits.refunded)} will be refunded to your card/bank</strong>
            {methods.length ? ` (${methods.join(', ')})` : ''}, R80 each, when your account is deleted.
          </p>
        )}
        {preview.credits.lapsing > 0 && (
          <p data-testid="credits-lapsing">
            Your {credits(preview.credits.lapsing)} that did not come from a payment (for example a test or goodwill
            credit) lapse when your account is deleted.
          </p>
        )}
        {preview.credits.refunded === 0 && preview.credits.lapsing === 0 && <p>You have no unused match credits.</p>}
        <p>
          Card and Apple Pay refunds go back automatically. For Capitec Pay or Instant EFT, our finance team may email you
          for your bank account details. We never keep your money (clause 20.2).
        </p>
      </Section>

      <Section title="What is deleted">
        <ul className="list-disc space-y-1 pl-5">
          <li>Your name (shown as "Deleted player"), photo, bio, username and email address</li>
          <li>Your date of birth, gender, city and positions</li>
          <li>Your friends, friend requests and blocks</li>
          <li>Your recruitment posts, "Looking for a team" card, team memberships and waiting-list entries</li>
          <li>Your notifications and sign-in sessions</li>
          <li>Your messages: they show as "Message from a deleted player" (the other person's messages stay)</li>
          <li>The team reviews you wrote</li>
        </ul>
      </Section>

      <Section title="What we keep, and why">
        <p>These records are kept only under an anonymous ID that cannot be linked back to your name or email:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Payment, ticket and refund records, for 5 years from the end of the tax year (Tax Administration Act)</li>
          <li>The record that you accepted our Terms, as evidence of the agreement (Electronic Communications and Transactions Act)</li>
          <li>Our audit and security records for 5 years, and conduct and safety records for 3 years</li>
          <li>Past lineups and results, shown as "Deleted player"</li>
        </ul>
        <p className="text-content-muted">
          See the{' '}
          <Link className="font-bold text-brand-700 hover:underline" to="/legal/terms#clause-20-1">
            Terms (clauses 8 and 20)
          </Link>
          . Want a copy of your data first? Use "Download my data" in Account settings.
        </p>
      </Section>
    </>
  );
}

export function DeleteAccountPage() {
  const preview = useDeletionPreview();
  const request = useRequestDeletion();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  if (preview.isPending) return <div className="mx-auto h-96 max-w-3xl animate-pulse rounded-3xl bg-surface" />;
  if (preview.error || !preview.data) return <FormError message={preview.error?.message ?? 'Something went wrong.'} />;
  const data = preview.data;

  const confirm = () =>
    request.mutate(
      { password, confirmation: 'DELETE' },
      {
        onSuccess: async ({ data: scheduled }) => {
          await cache.cancelQueries();
          cache.clear();
          cache.setQueryData(currentUserKey, null);
          navigate(`/account/deletion-scheduled?until=${encodeURIComponent(scheduled.scheduledFor)}`, { replace: true });
        },
        onError: () => void preview.refetch(),
      },
    );

  return (
    <section className="mx-auto grid max-w-3xl gap-4">
      <div>
        <h1 className="text-3xl font-bold text-content-strong">Delete my account</h1>
        <p className="mt-1 text-content-muted">Read what happens before you confirm.</p>
      </div>

      {!data.canDelete && (
        <section className="rounded-2xl border border-danger-200 bg-danger-50 p-5" aria-live="polite">
          <h2 className="text-lg font-bold text-danger-700">You can't delete your account yet</h2>
          <ul className="mt-3 grid gap-2 text-sm">
            {data.blockers.map((blocker) => (
              <li key={`${blocker.code}-${blocker.message}`}>
                {blocker.message}{' '}
                {blocker.targetPath ? (
                  <Link className="font-bold text-brand-700 hover:underline" to={blocker.targetPath}>
                    Open
                  </Link>
                ) : (
                  <Link className="font-bold text-brand-700 hover:underline" to="/support">
                    Contact support
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Summary preview={data} />

      {data.canDelete && (
        <section className="grid gap-3 rounded-2xl border border-danger-200 bg-surface p-5">
          <h2 className="text-lg font-bold text-content-strong">Confirm</h2>
          <Input
            label="Your password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Input
            label='Type DELETE to confirm'
            value={confirmation}
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <FormError message={request.error?.message} />
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-xl bg-danger-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              disabled={!password || confirmation !== 'DELETE' || request.isPending}
              onClick={confirm}
            >
              {request.isPending ? 'Deleting…' : 'Delete my account'}
            </button>
            <Button variant="ghost" onClick={() => navigate(-1)}>
              Keep my account
            </Button>
          </div>
        </section>
      )}
    </section>
  );
}
