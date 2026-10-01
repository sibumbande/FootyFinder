import { ApiError } from '@footy-finder/api-client';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Logo } from '@/components/Logo.js';
import { ThemeToggle } from '@/components/ThemeToggle.js';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { useNotifications } from '@/features/notifications/NotificationProvider.js';
import { TeamAvatar } from '../components/TeamAvatar.js';
import { useAcceptTeamInvite, useInspectTeamInvite } from '../hooks/useTeams.js';
import { plural } from '@/utils/plural.js';

export function TeamInvitePage() {
  const { token = '' } = useParams();
  const invite = useInspectTeamInvite(token);
  const accept = useAcceptTeamInvite(token);
  const { user, isPending: authPending } = useAuth();
  const { notify } = useNotifications();
  const navigate = useNavigate();
  const returnTo = `/teams/invite/${token}`;
  const join = () =>
    accept.mutate(undefined, {
      onSuccess: ({ data }) => {
        notify({
          variant: 'success',
          title: data.alreadyMember ? 'Already a member' : 'Joined Team',
          message: data.alreadyMember
            ? `You already belong to ${data.team.name}.`
            : `Welcome to ${data.team.name}.`,
        });
        navigate(`/teams/${data.team.id}`, { replace: true });
      },
    });
  const errorCode = invite.error instanceof ApiError ? invite.error.code : undefined;
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-[4.5rem] max-w-5xl items-center justify-between px-4">
          <Logo />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-2xl place-items-center px-4 py-10">
        {invite.isPending || authPending ? (
          <div className="h-80 w-full animate-pulse rounded-3xl bg-surface" />
        ) : invite.data ? (
          <section className="w-full overflow-hidden rounded-3xl border border-line bg-surface shadow-soft">
            <div className="h-24 bg-brand-900" />
            <div className="-mt-12 p-6 text-center sm:p-9">
              <div className="flex justify-center">
                <TeamAvatar team={invite.data.team} size="lg" />
              </div>
              <p className="mt-5 text-sm font-bold uppercase tracking-wider text-brand-700">
                Team invitation
              </p>
              <h1 className="mt-2 text-3xl font-black text-content-strong">
                You’ve been invited to {invite.data.team.name}
              </h1>
              <p className="mx-auto mt-3 max-w-lg text-content-muted">
                {invite.data.team.description ||
                  `${invite.data.invitedBy.displayName} invited you to join the squad.`}
              </p>
              <p className="mt-3 text-sm text-content-muted">
                {plural(invite.data.team.memberCount, 'member')} · invited by{' '}
                {invite.data.invitedBy.displayName}
              </p>
              {invite.data.status !== 'ACTIVE' ? (
                <div className="mt-6 rounded-xl border border-warning-200 bg-warning-50 p-4 font-semibold text-warning-700">
                  This invitation is {invite.data.status.toLowerCase()}.
                </div>
              ) : user ? (
                <Button className="mt-7 w-full sm:w-auto" onClick={join} loading={accept.isPending}>
                  Join Team
                </Button>
              ) : (
                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  <Link className="button" to={`/login?returnTo=${encodeURIComponent(returnTo)}`}>
                    Log in
                  </Link>
                  <Link
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line-strong bg-surface px-4 font-semibold text-content hover:bg-surface-hover"
                    to={`/register?returnTo=${encodeURIComponent(returnTo)}`}
                  >
                    Create Account
                  </Link>
                </div>
              )}
              <FormError message={accept.error?.message} />
            </div>
          </section>
        ) : (
          <section className="w-full rounded-3xl border border-line bg-surface p-8 text-center shadow-soft">
            <h1 className="text-2xl font-black text-content-strong">Invitation unavailable</h1>
            <FormError
              message={
                invite.error?.message ??
                (errorCode === 'TEAM_INVITE_EXPIRED'
                  ? 'This invitation expired.'
                  : 'This invitation is invalid.')
              }
            />
            <Link className="button mt-5" to="/">
              Go home
            </Link>
          </section>
        )}
      </main>
    </div>
  );
}
